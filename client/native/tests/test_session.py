import base64
import hashlib
import hmac
import json
import queue
import threading
import unittest
from urllib.parse import parse_qs, urlsplit

from openpath.session import Session, fetch_directory, parse_server, session_url


class FakeSocket:
    def __init__(self):
        self.messages = queue.Queue()
        self.closed = False
        self.sent = []

    def send(self, raw):
        message = json.loads(raw)
        self.sent.append(message)
        self.messages.put(json.dumps({"op": "fetch-res", "id": message["id"], "status": 200,
                                      "body": base64.b64encode(b"response text").decode(), "truncated": False}).encode())

    def recv(self, timeout):
        if self.closed:
            raise RuntimeError("closed")
        try:
            return self.messages.get(timeout=min(timeout, 0.05))
        except queue.Empty as error:
            raise TimeoutError() from error

    def close(self):
        self.closed = True


class Response:
    headers = {}
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def read(self, maximum):
        return json.dumps({"hosts": [
            {"online": True, "name": "Toronto", "country": "CA", "wssUrl": "wss://ca.example.com/ops"},
            {"online": True, "name": "downgrade", "wssUrl": "ws://bad.example.com/ops"},
            {"online": False, "name": "offline", "wssUrl": "wss://off.example.com/ops"},
            {"online": True, "name": "bad", "wssUrl": "wss://bad.example.com/?psk=oops"},
        ]}).encode()[:maximum]


class SessionTests(unittest.TestCase):
    def test_hmac_path_and_no_embedded_secrets(self):
        result = session_url("wss://example.com/ops?x=1", "demo", "correct horse", "fast")
        url = urlsplit(result)
        self.assertEqual(url.path, "/fast")
        params = parse_qs(url.query)
        timestamp, nonce, signature = params["auth"][0].split(".")
        self.assertEqual(signature, hmac.new(b"correct horse", f"{timestamp}.{nonce}./fast".encode(), hashlib.sha256).hexdigest())
        self.assertNotIn("correct", result)
        for value in ("https://example.com/", "wss://alice:pw@example.com/ops", "ws://example.com/?PSK=secret", "wss://example.com/#frag"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                parse_server(value)

    def test_directory_and_tls_downgrade(self):
        calls = []
        def request(req, timeout):
            calls.append(req.full_url)
            return Response()
        targets = fetch_directory("wss://example.com/ops", request)
        self.assertEqual(calls, ["https://example.com/api/hosts"])
        self.assertEqual([x["name"] for x in targets], ["Configured server", "Toronto"])

    def test_connect_fetch_and_disconnect(self):
        socket = FakeSocket()
        calls = []
        def connector(url, **kwargs):
            calls.append((url, kwargs))
            return socket
        session = Session(connector=connector)
        result = session.connect("ws://example.com/ops", "demo", "secret")
        self.assertEqual(result["state"], "connected")
        self.assertIn("unencrypted", result["message"])
        self.assertIsNone(calls[0][1]["proxy"])
        response = session.fetch("https://example.org/")
        self.assertEqual(response, {"status": 200, "body": "response text", "truncated": False})
        self.assertEqual(socket.sent[0]["op"], "fetch")
        with self.assertRaisesRegex(ValueError, "HTTP"):
            session.fetch("file:///etc/passwd")
        self.assertEqual(session.disconnect()["state"], "disconnected")
        self.assertTrue(socket.closed)
        with self.assertRaisesRegex(RuntimeError, "Connect"):
            session.fetch("https://example.org/")

    def test_cancel_during_handshake_does_not_reconnect(self):
        entered, release = threading.Event(), threading.Event()
        socket = FakeSocket()
        def connector(*_args, **_kwargs):
            entered.set()
            release.wait(3)
            return socket
        session = Session(connector=connector)
        errors = []
        def connect():
            try:
                session.connect("wss://example.com/ops", "demo", "secret")
            except Exception as error:
                errors.append(str(error))
        thread = threading.Thread(target=connect)
        thread.start()
        self.assertTrue(entered.wait(2))
        self.assertEqual(session.status()["state"], "connecting")
        session.disconnect()
        release.set()
        thread.join(3)
        self.assertFalse(thread.is_alive())
        self.assertTrue(socket.closed)
        self.assertIn("cancelled", errors[0])
        self.assertEqual(session.status()["state"], "disconnected")


if __name__ == "__main__":
    unittest.main()
