import hashlib
import hmac
import os
from pathlib import Path
import socket
import ssl
import struct
import sys
import tempfile
import threading
import unittest
from urllib.parse import parse_qs, urlsplit
from unittest.mock import patch

from openpath.stealth import StealthBridge, is_wireguard, pin_socket, stealth_url
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
        context.load_cert_chain(str(CERT), str(KEY))
        def handler(ws):
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
            # Isolate TLS and the UDP/WebSocket bridge from platform route APIs.
            with patch('openpath.stealth.egress_interface', return_value='lo'), patch('openpath.stealth.pin_socket'):
                with patch.dict(os.environ, {'SSL_CERT_FILE':str(CA)}):
                    bridge = StealthBridge()
                    udp_port = bridge.start(address, 'user', 'secret')
                    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as udp:
                        udp.bind(('127.0.0.1', 0)); udp.settimeout(5)
                        packet = bytes([1])+bytes(147)
                        udp.sendto(packet, ('127.0.0.1', udp_port))
                        self.assertEqual(udp.recv(2048), packet)
                    bridge.stop()
                # The public test CA is not a normal system trust anchor.
                with patch.dict(os.environ, {'SSL_CERT_FILE':str(Path(tempfile.gettempdir()) / 'nonexistent-test-ca')}):
                    with self.assertRaisesRegex(RuntimeError, 'Could not connect to the TLS relay'):
                        StealthBridge().start(address, 'user', 'secret')
        finally:
            server.shutdown(); thread.join(5)


if __name__ == '__main__': unittest.main()
