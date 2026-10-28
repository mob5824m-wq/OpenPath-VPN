"""Authenticated OpenPath WebSocket sessions; separate from device WireGuard."""
from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import secrets
import threading
import time
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from urllib.request import Request, build_opener

from .releases import NoRedirect

MAX_MESSAGE = 1024 * 1024


def parse_server(value: str):
    value = value.strip()
    if not value or len(value) > 2048 or any(ord(char) < 33 or ord(char) == 127 for char in value):
        raise ValueError("Enter a valid ws:// or wss:// server address")
    try:
        url = urlsplit(value)
        if url.scheme not in ("ws", "wss") or not url.hostname or url.username or url.password or url.fragment:
            raise ValueError()
        if url.port is not None and not 1 <= url.port <= 65535:
            raise ValueError()
        params = parse_qsl(url.query, keep_blank_values=True, max_num_fields=40)
    except ValueError as error:
        raise ValueError("Use a ws:// or wss:// server address without embedded credentials or a fragment") from error
    if any(key.lower() in ("psk", "password", "secret", "token", "auth") for key, _ in params):
        raise ValueError("Enter credentials in Settings, not in the server address")
    return url


def session_url(server: str, username: str, psk: str, mode: str = "stealth") -> str:
    url = parse_server(server)
    username = username.strip()
    if not username or len(username) > 128 or any(ord(c) < 32 for c in username) or not psk or len(psk) > 512:
        raise ValueError("A username and PSK are required")
    if mode not in ("stealth", "fast"):
        raise ValueError("Select a valid WebSocket session mode")
    path = url.path or "/ops"
    if mode == "fast" and path == "/ops":
        path = "/fast"
    elif mode == "stealth" and path == "/fast":
        path = "/ops"
    timestamp = str(int(time.time() * 1000))
    nonce = secrets.token_hex(12)
    signature = hmac.new(psk.encode(), f"{timestamp}.{nonce}.{path}".encode(), hashlib.sha256).hexdigest()
    params = [(key, value) for key, value in parse_qsl(url.query, keep_blank_values=True) if key.lower() not in ("user", "mode", "fast")]
    if mode == "fast":
        params.append(("mode", "fast"))
    params.extend((("auth", f"{timestamp}.{nonce}.{signature}"), ("user", username)))
    return urlunsplit((url.scheme, url.netloc, path, urlencode(params), ""))


def fetch_directory(server: str, opener=None) -> list[dict[str, str]]:
    """Return only online directory targets; do not silently downgrade TLS."""
    url = parse_server(server)
    main = urlunsplit((url.scheme, url.netloc, url.path or "/ops", url.query, ""))
    http = urlunsplit(("https" if url.scheme == "wss" else "http", url.netloc, "/api/hosts", "", ""))
    request = Request(http, headers={"Accept": "application/json", "User-Agent": "OpenPath-Native"})
    try:
        with (opener or build_opener(NoRedirect()).open)(request, timeout=8) as response:
            if int(response.headers.get("Content-Length", "0")) > MAX_MESSAGE:
                raise ValueError("Server directory is too large")
            content = response.read(MAX_MESSAGE + 1)
            if len(content) > MAX_MESSAGE:
                raise ValueError("Server directory is too large")
            directory = json.loads(content)
    except Exception as error:
        raise RuntimeError(f"Could not load the server directory ({type(error).__name__})") from error
    if not isinstance(directory, dict) or not isinstance(directory.get("hosts"), list):
        raise ValueError("Server returned an invalid directory")
    result = [{"name": "Configured server", "url": main, "country": "", "region": ""}]
    for host in directory["hosts"][:500]:
        if not isinstance(host, dict) or host.get("online") is not True:
            continue
        target = host.get("wssUrl")
        if not isinstance(target, str):
            continue
        try:
            parsed = parse_server(target)
            if url.scheme == "wss" and parsed.scheme != "wss":
                continue
        except ValueError:
            continue
        result.append({"name": str(host.get("name") or "Server")[:100], "url": target,
                       "country": str(host.get("country") or "")[:32], "region": str(host.get("region") or "")[:100]})
    return result


class Session:
    def __init__(self, connector=None):
        self.connector = connector
        self._lock = threading.RLock()
        self._generation = 0
        self._socket = None
        self._state = "disconnected"
        self._message = "Not connected. This session does not route device traffic."
        self._server = ""
        self._pending: dict[str, dict] = {}

    def status(self) -> dict[str, str]:
        with self._lock:
            return {"state": self._state, "message": self._message, "server": self._server}

    def begin(self) -> int:
        with self._lock:
            if self._state != "disconnected":
                raise RuntimeError("A WebSocket session is already connected or connecting")
            self._generation += 1
            self._state = "connecting"
            self._message = "Connecting…"
            return self._generation

    def connect(self, server: str, username: str, psk: str, mode: str = "stealth", generation: int | None = None) -> dict[str, str]:
        try:
            target = session_url(server, username, psk, mode)
            safe = parse_server(server)
        except Exception:
            with self._lock:
                if generation is not None and generation == self._generation:
                    self._state = "disconnected"
                    self._message = "The session settings are invalid."
            raise
        with self._lock:
            if generation is None:
                generation = self.begin()
            elif generation != self._generation or self._state != "connecting":
                raise RuntimeError("Connection cancelled")
            self._server = safe.netloc
        try:
            if self.connector is None:
                from websockets.sync.client import connect
                connector = connect
            else:
                connector = self.connector
            # No environment proxy: credentials should go only to the chosen host.
            socket = connector(target, open_timeout=8, close_timeout=1, max_size=MAX_MESSAGE, proxy=None)
        except Exception as error:
            with self._lock:
                if generation != self._generation:
                    raise RuntimeError("Connection cancelled") from error
                self._state = "disconnected"
                self._message = "Could not connect or authenticate; check the server and credentials."
            raise RuntimeError(f"Could not connect or authenticate ({type(error).__name__})") from error
        with self._lock:
            if generation != self._generation:
                socket.close()
                raise RuntimeError("Connection cancelled")
            self._socket = socket
            self._state = "connected"
            self._message = "Connected over TLS; device traffic is not routed." if safe.scheme == "wss" else "Connected over unencrypted ws://; device traffic is not routed."
            result = self.status()
        threading.Thread(target=self._read, args=(socket, generation), daemon=True, name="openpath-session").start()
        return result

    def _read(self, socket, generation: int):
        try:
            while True:
                try:
                    raw = socket.recv(timeout=1)
                except TimeoutError:
                    with self._lock:
                        if generation != self._generation:
                            return
                    continue
                if isinstance(raw, bytes):
                    try:
                        raw = raw.decode("utf-8")
                    except UnicodeDecodeError:
                        continue
                try:
                    message = json.loads(raw)
                except (ValueError, TypeError):
                    continue
                if not isinstance(message, dict) or message.get("op") != "fetch-res" or not isinstance(message.get("id"), str):
                    continue
                with self._lock:
                    pending = self._pending.get(message["id"])
                    if pending:
                        pending["response"] = message
                        pending["event"].set()
        except Exception:
            with self._lock:
                if generation == self._generation:
                    self._state = "disconnected"
                    self._socket = None
                    self._message = "The WebSocket session ended. Device VPN status is unchanged."
                    self._fail_pending("The WebSocket session ended")

    def _fail_pending(self, message: str):
        for pending in self._pending.values():
            pending["error"] = message
            pending["event"].set()

    def cancel(self):
        # Invalidate an in-flight handshake immediately, before closing a socket.
        with self._lock:
            self._generation += 1
            socket, self._socket = self._socket, None
            self._state = "disconnected"
            self._message = "WebSocket session disconnected. Device VPN status is unchanged."
            self._fail_pending("The WebSocket session was disconnected")
            return socket

    @staticmethod
    def close_socket(socket):
        if socket is not None:
            try:
                socket.close()
            except Exception:
                pass

    def disconnect(self) -> dict[str, str]:
        self.close_socket(self.cancel())
        return self.status()

    def fetch(self, address: str) -> dict:
        address = address.strip()
        try:
            url = urlsplit(address)
            if len(address) > 2048 or any(ord(c) < 33 or ord(c) == 127 for c in address) or url.scheme not in ("http", "https") or not url.hostname or url.username or url.password or url.fragment:
                raise ValueError()
            if url.port is not None and not 1 <= url.port <= 65535:
                raise ValueError()
        except ValueError as error:
            raise ValueError("Enter an HTTP(S) URL without embedded credentials") from error
        request_id = secrets.token_hex(12)
        pending = {"event": threading.Event()}
        with self._lock:
            if self._state != "connected" or self._socket is None:
                raise RuntimeError("Connect the WebSocket session first")
            socket = self._socket
            self._pending[request_id] = pending
        try:
            socket.send(json.dumps({"op": "fetch", "id": request_id, "method": "GET", "url": address}))
            if not pending["event"].wait(20):
                raise RuntimeError("The server did not answer the fetch request")
            if "error" in pending:
                raise RuntimeError(pending["error"])
            response = pending["response"]
            if not isinstance(response.get("status"), int) or not isinstance(response.get("body"), str):
                raise ValueError("Invalid fetch response")
            try:
                body = base64.b64decode(response["body"], validate=True)
            except (ValueError, binascii.Error) as error:
                raise ValueError("Invalid fetch response body") from error
            return {"status": response["status"], "body": body[:6000].decode("utf-8", errors="replace"),
                    "truncated": bool(response.get("truncated")) or len(body) > 6000}
        finally:
            with self._lock:
                self._pending.pop(request_id, None)
