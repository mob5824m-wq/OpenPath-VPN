"""Disposable macOS wireguard-go loopback handshake through the TLS relay.

Runs only on an isolated CI VM with passwordless sudo. It does not validate
public egress or scoped routing on every physical network.
"""
import os
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
import time

from openpath.stealth import StealthBridge
from openpath.wireguard import DeviceVPN, apple_interface_from_output, apple_script_command

ROOT = Path(__file__).resolve().parents[1]
WG = shutil.which('wg')
QUICK = shutil.which('wg-quick')
assert WG and QUICK, 'Install WireGuard tools first'


def command(*args, input=None):
    result = subprocess.run(args, input=input, text=True, capture_output=True, check=False)
    if result.returncode:
        # These commands never print config contents; don't include their input.
        raise RuntimeError(f"{Path(args[0]).name} failed ({result.returncode}): {(result.stderr or result.stdout)[-1500:]}")
    return result.stdout.strip()


def sudo(*args):
    return command('sudo', '-n', 'env', f'PATH={os.environ["PATH"]}', *args)


def keypair():
    private = command(WG, 'genkey')
    return private, command(WG, 'pubkey', input=private + '\n')


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
    client_config = root / 'opvpn0.conf'
    server_up = client_up = False
    relay = None
    bridge = StealthBridge(platform='darwin')
    try:
        sudo(QUICK, 'up', str(server_config))
        server_up = True
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
        port = bridge.start('wss://127.0.0.1:18443', 'ci-test', 'only-for-disposable-ci-tests-not-production-123')
        client_config.write_text(f'''[Interface]
PrivateKey = {client_private}
Address = 10.203.0.2/32, fd70::2/128
[Peer]
PublicKey = {server_public}
Endpoint = 127.0.0.1:{port}
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = 2
''', encoding='ascii')
        # Exercise the same shell command the app passes to AppleScript, but
        # use CI's passwordless sudo instead of an interactive GUI prompt.
        apple_script = apple_script_command(QUICK, 'up', str(client_config))
        shell_command = json.loads(apple_script[len('do shell script '):-len(' with administrator privileges')])
        output = sudo('/bin/sh', '-c', shell_command)
        client_up = True
        actual_name = apple_interface_from_output(output)
        assert actual_name and actual_name == sudo('/bin/cat', '/var/run/wireguard/opvpn0.name')
        # On CI, wireguard-go's runtime directory is root-only. Verify the
        # ordinary unprivileged app can use its recorded utun identity.
        vpn = DeviceVPN(root, platform='darwin')
        vpn.directory.mkdir(parents=True, exist_ok=True)
        vpn.marker.write_text(json.dumps({'identity': f'utun:{actual_name}'}))
        assert vpn.runtime_status()['state'] == 'active', vpn.runtime_status()
        deadline = time.monotonic() + 45
        handshake = '0'
        while time.monotonic() < deadline:
            out = sudo(WG, 'show', actual_name, 'latest-handshakes').split()
            if len(out) == 2 and int(out[-1]) > 0:
                handshake = out[-1]
                break
            time.sleep(.5)
        assert handshake != '0', 'macOS WireGuard did not handshake through the loopback TLS relay'
        assert '127.0.0.1:' in sudo(WG, 'show', actual_name, 'endpoints')
        assert bridge.status() == 'connected'
        print('macOS wireguard-go established a real loopback peer handshake through verified TLS.', flush=True)
        relay.terminate(); relay.wait(timeout=10)
        # A silent TCP loss may only be detected by the WebSocket ping timer.
        deadline = time.monotonic() + 35
        while bridge.status() == 'connected' and time.monotonic() < deadline:
            time.sleep(.1)
        assert bridge.status() == 'failed', f"relay exit={relay.poll()}, bridge={bridge.status()}"
        assert '127.0.0.1:' in sudo(WG, 'show', actual_name, 'endpoints')
        print('Relay failure reported separately; endpoint did not fall back to direct UDP.', flush=True)
        sudo(QUICK, 'down', str(client_config))
        client_up = False
        assert vpn.runtime_status()['state'] in ('inactive', 'unverified'), vpn.runtime_status()
    finally:
        if client_up:
            try: sudo(QUICK, 'down', str(client_config))
            except Exception as error: print(f'Client teardown failed: {type(error).__name__}', flush=True)
        bridge.stop()
        if relay and relay.poll() is None:
            relay.terminate(); relay.wait(timeout=10)
        if server_up:
            try: sudo(QUICK, 'down', str(server_config))
            except Exception as error: print(f'Server teardown failed: {type(error).__name__}', flush=True)
