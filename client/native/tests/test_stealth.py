import hashlib
import hmac
import os
from pathlib import Path
import select
import socket
import ssl
import struct
import sys
import tempfile
import threading
import unittest
from urllib.parse import parse_qs, urlsplit
from unittest.mock import patch

from openpath.stealth import StealthBridge, _relay_tls_context, is_wireguard, pin_socket, stealth_url
from openpath.wireguard import DeviceVPN
from test_wireguard import FakeKeychain, SAMPLE

ROOT = Path(__file__).resolve().parents[3]
CERT = ROOT / 'server/tests/fixtures/stealth-test-cert.pem'
KEY = ROOT / 'server/tests/fixtures/stealth-test-key.pem'
CA = ROOT / 'client/android/app/src/debug/res/raw/stealth_test_ca.pem'


class FakeBridge:
    def __init__(self):
        self.state = 'stopped'
        self.args = None
    def start(self, *args):
        self.args = args
        self.state = 'connected'
        return 45454
    def status(self): return self.state
    def stop(self): self.state = 'stopped'


class TcpTap:
    """Forward one test TCP connection and record both directions on the wire."""
    def __init__(self, target_port):
        self.client_data = bytearray()
        self.server_data = bytearray()
        self.stop = threading.Event()
        self.listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.listener.bind(('127.0.0.1', 0))
        self.listener.listen(1)
        self.listener.settimeout(5)
        self.port = self.listener.getsockname()[1]
        self.target_port = target_port
        self.thread = threading.Thread(target=self._forward, daemon=True)
        self.thread.start()

    def _forward(self):
        try:
            client, _ = self.listener.accept()
            with client, socket.create_connection(('127.0.0.1', self.target_port), timeout=5) as upstream:
                client.settimeout(5)
                upstream.settimeout(5)
                while not self.stop.is_set():
                    readable, _, _ = select.select([client, upstream], [], [], 0.1)
                    for source in readable:
                        data = source.recv(65536)
                        if not data:
                            return
                        (self.client_data if source is client else self.server_data).extend(data)
                        (upstream if source is client else client).sendall(data)
        except OSError:
            # The assertions inspect the captured stream; socket closure during
            # test cleanup or a failed handshake is expected.
            pass
        finally:
            self.listener.close()

    def finish(self):
        self.thread.join(3)
        self.stop.set()
        self.thread.join(2)
        self.listener.close()
        if self.thread.is_alive():
            raise AssertionError('TCP capture did not stop')
        return bytes(self.client_data), bytes(self.server_data)


class StealthTests(unittest.TestCase):
    def test_signing_requires_tls_and_exact_relay_path(self):
        url = urlsplit(stealth_url('wss://relay.example/ops', 'user', 'secret'))
        self.assertEqual(url.path, '/stealth-wg')
        query = parse_qs(url.query)
        ts, nonce, signature = query['auth'][0].split('.')
        expected = hmac.new(b'secret', f'{ts}.{nonce}./stealth-wg'.encode(), hashlib.sha256).hexdigest()
        self.assertEqual(signature, expected)
        for bad in ('ws://relay.example/ops', 'wss://u:p@relay.example', 'wss://relay.example/?x=1'):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                stealth_url(bad, 'user', 'secret')
        self.assertTrue(is_wireguard(bytes([1])+bytes(147)))
        self.assertFalse(is_wireguard(bytes([1])+bytes(146)))
        self.assertFalse(is_wireguard(bytes([4])+bytes(4096)))

    def test_relay_context_requires_modern_verified_tls(self):
        context = _relay_tls_context()
        self.assertGreaterEqual(context.minimum_version, ssl.TLSVersion.TLSv1_2)
        self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
        self.assertTrue(context.check_hostname)
        strict = ssl.create_default_context()
        strict.minimum_version = ssl.TLSVersion.TLSv1_3
        with patch('openpath.stealth.ssl.create_default_context', return_value=strict):
            self.assertEqual(_relay_tls_context().minimum_version, ssl.TLSVersion.TLSv1_3)

    def test_platform_socket_pins(self):
        class MockSocket:
            def __init__(self): self.calls = []
            def setsockopt(self, *args): self.calls.append(args)
        sock = MockSocket()
        pin_socket(sock, 'eth0', 'linux')
        self.assertEqual(sock.calls[-1], (socket.SOL_SOCKET, getattr(socket, 'SO_BINDTODEVICE', 25), b'eth0\0'))
        pin_socket(sock, 7, 'darwin')
        self.assertEqual(sock.calls[-1], (socket.IPPROTO_IP, 25, 7))
        pin_socket(sock, 9, 'win32')
        self.assertEqual(sock.calls[-1], (socket.IPPROTO_IP, 31, struct.pack('!I', 9)))
        with self.assertRaises(RuntimeError): pin_socket(sock, 1, 'unsupported')

    def test_device_lifecycle_no_direct_fallback_and_external_removal(self):
        with tempfile.TemporaryDirectory() as root:
            source = Path(root) / 'source.conf'
            source.write_text(SAMPLE)
            active = False
            applied = []
            bridge = FakeBridge()
            def run(args, **_):
                nonlocal active
                if args[0].endswith('/ip'):
                    if active: return '42: opvpn0: <UP> mtu 1420'
                    raise RuntimeError('Device "opvpn0" does not exist.')
                action, filename = args[-2:]
                if action == 'up': applied.append(Path(filename).read_text()); active = True
                else: active = False
                return ''
            vpn = DeviceVPN(root, platform='linux', keychain=FakeKeychain(), find=lambda c:c[0], run=run,
                            relay_factory=lambda:bridge)
            vpn.import_file(source)
            options = {'transport':'stealth', 'relayServer':'wss://relay.example', 'relayUsername':'user', 'relayPsk':'secret'}
            status = vpn.connect(options)
            self.assertEqual(status['transport'], 'stealth')
            self.assertEqual(status['relayState'], 'connected')
            self.assertIn('Endpoint = 127.0.0.1:45454', applied[0])
            self.assertNotIn('vpn.example.com:51820', applied[0])
            self.assertNotIn('secret', vpn.marker.read_text())
            bridge.state = 'failed'
            self.assertIn('No direct fallback', vpn.status()['message'])
            self.assertEqual(vpn.disconnect()['state'], 'inactive')
            self.assertEqual(bridge.state, 'stopped')
            self.assertFalse(vpn.relay_running())
            vpn.connect(options)
            active = False  # User removed the interface outside the app.
            vpn.status()
            self.assertFalse(vpn.relay_running())

    def test_oversized_stealth_mtu_is_rejected_before_connecting(self):
        with tempfile.TemporaryDirectory() as root:
            source = Path(root) / 'source.conf'
            source.write_text(SAMPLE.replace('DNS = 1.1.1.1', 'DNS = 1.1.1.1\nMTU = 2000'))
            bridge = FakeBridge()
            def run(args, **_): raise RuntimeError('Device "opvpn0" does not exist.')
            vpn = DeviceVPN(root, platform='linux', keychain=FakeKeychain(), find=lambda c:c[0], run=run,
                            relay_factory=lambda:bridge)
            vpn.import_file(source)
            with self.assertRaisesRegex(ValueError, 'MTU'):
                vpn.connect({'transport':'stealth'})
            self.assertEqual(bridge.state, 'stopped')

    def test_windows_requires_explicit_firewall_acknowledgment_and_splits_only_stealth(self):
        with tempfile.TemporaryDirectory() as root:
            source = Path(root) / 'source.conf'; source.write_text(SAMPLE)
            state = {'active':False, 'config':''}
            bridge = FakeBridge()
            def run(args, **kwargs):
                script = args[-1]
                if 'Directory]::GetAccessControl' in script: return ''
                if 'Get-Service' in script: return 'Running' if state['active'] else 'absent'
                env = kwargs['env']
                if env['OPVPN_ACTION'] == '/installtunnelservice':
                    state['config'] = Path(env['OPVPN_ARGUMENT']).read_text(); state['active'] = True
                else: state['active'] = False
                return ''
            vpn = DeviceVPN(root, platform='win32', keychain=FakeKeychain(), find=lambda c:c[0], run=run,
                            relay_factory=lambda:bridge)
            vpn.import_file(source)
            options = {'transport':'stealth', 'relayServer':'wss://relay', 'relayUsername':'u', 'relayPsk':'s'}
            with self.assertRaisesRegex(ValueError, 'block-untunneled'):
                vpn.connect(options)
            self.assertEqual(bridge.state, 'stopped')
            vpn.connect({**options, 'allowWindowsStealthWithoutKillSwitch':'yes'})
            self.assertIn('AllowedIPs = 0.0.0.0/1, 128.0.0.0/1, ::/1, 8000::/1', state['config'])
            vpn.disconnect()
            vpn.connect()
            self.assertIn('AllowedIPs = 0.0.0.0/0, ::/0', state['config'])
            vpn.disconnect()

    def test_real_tls_websocket_bridge_and_certificate_validation(self):
        from websockets.sync.server import serve
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.minimum_version = ssl.TLSVersion.TLSv1_2
        context.load_cert_chain(str(CERT), str(KEY))
        negotiated = []
        def handler(ws):
            negotiated.append(ws.socket.version())
            ws.send('{"type":"ready","protocol":"wireguard-ws","version":1}')
            try:
                data = ws.recv(timeout=5)
                ws.send(data)
            except Exception:
                pass
        server = serve(handler, '127.0.0.1', 0, ssl=context)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        port = server.socket.getsockname()[1]
        address = f'wss://127.0.0.1:{port}/ops'
        try:
            # Capture the outer TCP stream, not the decrypted WebSocket.
            # Route APIs are mocked; the TLS handshake and UDP bridge are real.
            with patch('openpath.stealth.egress_interface', return_value='lo'), patch('openpath.stealth.pin_socket'):
                tap = TcpTap(port)
                try:
                    with patch.dict(os.environ, {'SSL_CERT_FILE':str(CA)}):
                        bridge = StealthBridge()
                        try:
                            udp_port = bridge.start(f'wss://127.0.0.1:{tap.port}', 'user', 'secret')
                            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as udp:
                                udp.bind(('127.0.0.1', 0)); udp.settimeout(5)
                                packet = bytes([1, 0, 0, 0]) + bytes(range(1, 145))
                                udp.sendto(packet, ('127.0.0.1', udp_port))
                                self.assertEqual(udp.recv(2048), packet)
                        finally:
                            bridge.stop()
                finally:
                    outbound, inbound = tap.finish()
                self.assertTrue(negotiated and negotiated[0] in ('TLSv1.2', 'TLSv1.3'))
                for captured, hello_type in ((outbound, 1), (inbound, 2)):
                    self.assertGreaterEqual(len(captured), 6)
                    self.assertEqual(captured[0], 22)  # TLS handshake record
                    self.assertEqual(captured[1], 3)
                    self.assertEqual(captured[5], hello_type)  # ClientHello / ServerHello
                    self.assertNotIn(packet, captured)
                    # Every complete outer record is TLS; at least one encrypted
                    # application-data record carries the upgrade / VPN frames.
                    offset, types = 0, []
                    while offset + 5 <= len(captured):
                        kind, major = captured[offset], captured[offset + 1]
                        size = int.from_bytes(captured[offset + 3:offset + 5], 'big')
                        self.assertIn(kind, (20, 21, 22, 23))
                        self.assertEqual(major, 3)
                        self.assertLessEqual(size, 18432)
                        if offset + 5 + size > len(captured):
                            break  # An interrupted close may leave a partial last record.
                        types.append(kind)
                        offset += 5 + size
                    self.assertIn(23, types)
                self.assertNotIn(b'GET /stealth-wg', outbound)
                self.assertNotIn(b'HTTP/1.1 101', inbound)

                # A trusted CA must not make a certificate for a different host valid.
                fake_dns = [(socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, '', ('127.0.0.1', port))]
                with patch.dict(os.environ, {'SSL_CERT_FILE':str(CA)}), \
                     patch('openpath.stealth.socket.getaddrinfo', return_value=fake_dns):
                    with self.assertRaisesRegex(RuntimeError, 'Could not connect to the TLS relay') as rejected:
                        StealthBridge().start(f'wss://wrong-host.invalid:{port}', 'user', 'secret')
                    self.assertIsInstance(rejected.exception.__cause__, ssl.SSLCertVerificationError)
                # The public test CA is not a normal system trust anchor.
                with patch.dict(os.environ, {'SSL_CERT_FILE':str(Path(tempfile.gettempdir()) / 'nonexistent-test-ca')}):
                    with self.assertRaisesRegex(RuntimeError, 'Could not connect to the TLS relay') as rejected:
                        StealthBridge().start(address, 'user', 'secret')
                    self.assertIsInstance(rejected.exception.__cause__, ssl.SSLCertVerificationError)
        finally:
            server.shutdown(); thread.join(5)


if __name__ == '__main__': unittest.main()
