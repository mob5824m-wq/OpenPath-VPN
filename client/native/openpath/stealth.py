"""Authenticated WireGuard-over-TLS relay for a device VPN.

Only the outer TCP socket is pinned to the pre-VPN egress interface. No route
exceptions are installed, and failures never fall back to direct WireGuard.
"""
from __future__ import annotations

import ipaddress
import json
import re
import socket
import ssl
import struct
import subprocess
import sys
import threading
from urllib.parse import urlunsplit

from .session import parse_server, session_url

PATH = '/stealth-wg'
MAX_PACKET = 2048


def stealth_url(server: str, username: str, psk: str) -> str:
    url = parse_server(server)
    if url.scheme != 'wss' or url.query:
        raise ValueError('Stealth VPN requires a wss:// server address without query parameters')
    # A relay is an explicit, fixed endpoint, not the unrelated /ops session.
    base = urlunsplit(('wss', url.netloc, PATH, '', ''))
    return session_url(base, username, psk)


def is_wireguard(data: bytes) -> bool:
    if len(data) < 4 or len(data) > MAX_PACKET or data[1:4] != b'\0\0\0':
        return False
    return ((data[0] == 1 and len(data) == 148) or (data[0] == 2 and len(data) == 92) or
            (data[0] == 3 and len(data) == 64) or (data[0] == 4 and len(data) >= 32))


def egress_interface(address: str, platform: str = sys.platform) -> str | int:
    """Discover the route BEFORE starting the VPN. IPv4 relay egress only."""
    ipaddress.IPv4Address(address)
    if platform.startswith('linux'):
        result = subprocess.run(['ip', '-j', 'route', 'get', address], capture_output=True, text=True, timeout=5, check=True)
        routes = json.loads(result.stdout)
        device = routes[0].get('dev') if isinstance(routes, list) and routes else None
        if not isinstance(device, str) or not re.fullmatch(r'[A-Za-z0-9_.:@-]{1,15}', device) or device == 'opvpn0':
            raise RuntimeError('Could not identify the relay egress interface')
        return device
    if platform == 'darwin':
        result = subprocess.run(['/sbin/route', '-n', 'get', address], capture_output=True, text=True, timeout=5, check=True)
        match = re.search(r'^\s*interface:\s*(\S+)\s*$', result.stdout, re.M)
        if not match:
            raise RuntimeError('Could not identify the relay egress interface')
        return socket.if_nametoindex(match.group(1))
    if platform == 'win32':
        import ctypes
        from ctypes import wintypes
        index = wintypes.DWORD()
        destination = struct.unpack('=I', socket.inet_aton(address))[0]
        api = ctypes.WinDLL('iphlpapi', use_last_error=True)
        api.GetBestInterface.argtypes = [wintypes.DWORD, ctypes.POINTER(wintypes.DWORD)]
        api.GetBestInterface.restype = wintypes.DWORD
        if api.GetBestInterface(destination, ctypes.byref(index)) or not index.value:
            raise RuntimeError('Could not identify the relay egress interface')
        return int(index.value)
    raise RuntimeError('Stealth VPN is unsupported on this operating system')


def pin_socket(sock: socket.socket, interface: str | int, platform: str = sys.platform) -> None:
    if platform.startswith('linux'):
        sock.setsockopt(socket.SOL_SOCKET, getattr(socket, 'SO_BINDTODEVICE', 25), str(interface).encode() + b'\0')
    elif platform == 'darwin':
        sock.setsockopt(socket.IPPROTO_IP, 25, int(interface))  # IP_BOUND_IF
    elif platform == 'win32':
        sock.setsockopt(socket.IPPROTO_IP, 31, struct.pack('!I', int(interface)))  # IP_UNICAST_IF
    else:
        raise RuntimeError('Stealth VPN is unsupported on this operating system')


class StealthBridge:
    def __init__(self, *, platform: str = sys.platform):
        self.platform = platform
        self._lock = threading.RLock()
        self._stop = threading.Event()
        self._udp: socket.socket | None = None
        self._ws = None
        self._state = 'stopped'
        self._peer: tuple[str, int] | None = None
        self._port = 0

    def status(self) -> str:
        with self._lock:
            return self._state

    def start(self, server: str, username: str, psk: str) -> int:
        url = stealth_url(server, username, psk)
        parsed = parse_server(server)
        # Resolve before the full-device tunnel exists. The selected address and
        # interface remain fixed; network changes require disconnect/reconnect.
        try:
            addresses = socket.getaddrinfo(parsed.hostname, parsed.port or 443, socket.AF_INET, socket.SOCK_STREAM)
            if not addresses:
                raise RuntimeError('No IPv4 relay address')
            address = addresses[0][4][0]
            interface = egress_interface(address, self.platform)
            outer = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            try:
                pin_socket(outer, interface, self.platform)
                outer.settimeout(8)
                outer.connect((address, parsed.port or 443))
                from websockets.sync.client import connect
                ws = connect(url, sock=outer, ssl=ssl.create_default_context(), server_hostname=parsed.hostname,
                             open_timeout=8, close_timeout=1, compression=None, max_size=MAX_PACKET, max_queue=32,
                             ping_interval=20, ping_timeout=20, proxy=None)
            except Exception:
                outer.close()
                raise
            try:
                ready = ws.recv(timeout=8)
                if not isinstance(ready, str) or json.loads(ready) != {'type':'ready', 'protocol':'wireguard-ws', 'version':1}:
                    raise RuntimeError('Relay did not confirm the WireGuard protocol')
                udp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                udp.bind(('127.0.0.1', 0))
                udp.settimeout(1)
            except Exception:
                ws.close()
                raise
        except Exception as error:
            # Never expose the signed URL or PSK in UI errors or logs.
            raise RuntimeError(f'Could not connect to the TLS relay ({type(error).__name__}). Check server, certificate and credentials.') from error
        with self._lock:
            self._ws, self._udp = ws, udp
            self._port = udp.getsockname()[1]
            self._state = 'connected'
        threading.Thread(target=self._from_wireguard, daemon=True, name='openpath-wg-udp').start()
        threading.Thread(target=self._from_relay, daemon=True, name='openpath-wg-wss').start()
        return self._port

    def _from_wireguard(self) -> None:
        try:
            while not self._stop.is_set():
                try:
                    data, peer = self._udp.recvfrom(MAX_PACKET + 1)
                except TimeoutError:
                    continue
                if peer[0] != '127.0.0.1' or not is_wireguard(data):
                    continue
                with self._lock:
                    if self._peer is None:
                        self._peer = peer
                    if self._peer != peer:
                        continue
                    ws = self._ws
                ws.send(data)
        except Exception:
            self._failed()

    def _from_relay(self) -> None:
        try:
            while not self._stop.is_set():
                try:
                    data = self._ws.recv(timeout=1)
                except TimeoutError:
                    continue
                if not isinstance(data, bytes) or not is_wireguard(data):
                    raise RuntimeError('Invalid relay packet')
                with self._lock:
                    peer, udp = self._peer, self._udp
                if peer is not None:
                    udp.sendto(data, peer)
        except Exception:
            self._failed()

    def _failed(self) -> None:
        with self._lock:
            if not self._stop.is_set():
                self._state = 'failed'
        self._stop.set()
        # Closing from the receive and send threads is safe and idempotent.
        self._close_sockets()

    def _close_sockets(self) -> None:
        with self._lock:
            ws, udp = self._ws, self._udp
            self._ws = self._udp = None
        try:
            if udp: udp.close()
        except OSError:
            pass
        try:
            if ws: ws.close()
        except Exception:
            pass

    def stop(self) -> None:
        self._stop.set()
        with self._lock:
            self._state = 'stopped'
        self._close_sockets()
