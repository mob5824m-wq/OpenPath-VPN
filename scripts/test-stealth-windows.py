"""Disposable Windows WireGuardNT loopback handshake over the real TLS relay.

Runs only on an administrative, isolated CI VM. It does not verify public egress
or behavior on every Windows network configuration.
"""
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import threading
import time

from openpath.wireguard import DeviceVPN

ROOT = Path(__file__).resolve().parents[1]
WG_DIR = Path(os.environ.get('ProgramFiles', r'C:\Program Files')) / 'WireGuard'
WG = str(WG_DIR / 'wg.exe')
MANAGER = str(WG_DIR / 'wireguard.exe')


def command(*args, input=None):
    return subprocess.run(args, input=input, text=True, capture_output=True, check=True).stdout.strip()


def keypair():
    private = command(WG, 'genkey')
    public = command(WG, 'pubkey', input=private + '\n')
    return private, public


class MemoryKeychain:
    def __init__(self): self.data = None
    def read(self): return self.data
    def write(self, data): self.data = data
    def remove(self): self.data = None


with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    server_private, server_public = keypair()
    client_private, client_public = keypair()
    server_config = root / 'optest.conf'
    server_config.write_text(f'''[Interface]
PrivateKey = {server_private}
Address = 10.203.0.1/24
ListenPort = 51820
[Peer]
PublicKey = {client_public}
AllowedIPs = 10.203.0.2/32
''', encoding='ascii')
    client_config = root / 'client.conf'
    client_config.write_text(f'''[Interface]
PrivateKey = {client_private}
Address = 10.203.0.2/32, fd70::2/128
DNS = 1.1.1.1
[Peer]
PublicKey = {server_public}
Endpoint = 127.0.0.1:51820
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = 2
''', encoding='ascii')
    server_installed = False
    vpn = DeviceVPN(root, platform='win32', keychain=MemoryKeychain())
    relay = None
    try:
        command(MANAGER, '/installtunnelservice', str(server_config))
        server_installed = True
        relay = subprocess.Popen(['node', '--import', 'tsx', 'tests/fixtures/stealth-test-server.ts'],
                                 cwd=ROOT / 'server', stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        ready = threading.Event()
        output = []
        def read_ready():
            output.append(relay.stdout.readline().strip())
            ready.set()
        threading.Thread(target=read_ready, daemon=True).start()
        if not ready.wait(30) or output != ['TEST RELAY READY']:
            raise RuntimeError('Test TLS relay did not start')
        os.environ['SSL_CERT_FILE'] = str(ROOT / 'client/android/app/src/debug/res/raw/stealth_test_ca.pem')
        vpn.import_file(client_config)
        result = vpn.connect({'transport':'stealth', 'relayServer':'wss://127.0.0.1:18443',
                              'relayUsername':'ci-test', 'relayPsk':'only-for-disposable-ci-tests-not-production-123',
                              'allowWindowsStealthWithoutKillSwitch':'yes'})
        assert result['owned'] and result['relayState'] == 'connected', result
        deadline = time.monotonic() + 45
        handshake = '0'
        while time.monotonic() < deadline:
            out = command(WG, 'show', 'opvpn0', 'latest-handshakes').split()
            if len(out) == 2 and int(out[-1]) > 0:
                handshake = out[-1]
                break
            time.sleep(.5)
        assert handshake != '0', 'Windows WireGuardNT did not handshake through the loopback TLS relay'
        endpoint = command(WG, 'show', 'opvpn0', 'endpoints')
        assert '127.0.0.1:' in endpoint, endpoint
        print('Windows WireGuardNT established a real loopback peer handshake through verified TLS.', flush=True)
        relay.terminate()
        relay.wait(timeout=10)
        deadline = time.monotonic() + 10
        while vpn.status()['relayState'] == 'connected' and time.monotonic() < deadline:
            time.sleep(.1)
        assert vpn.status()['relayState'] == 'failed'
        assert '127.0.0.1:' in command(WG, 'show', 'opvpn0', 'endpoints')
        print('Relay failure reported separately; endpoint did not fall back to direct UDP.', flush=True)
    finally:
        try:
            if vpn.status()['owned']:
                vpn.disconnect()
        finally:
            if relay and relay.poll() is None:
                relay.terminate(); relay.wait(timeout=10)
            if server_installed:
                subprocess.run([MANAGER, '/uninstalltunnelservice', 'optest'], capture_output=True)
