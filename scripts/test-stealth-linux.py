"""Disposable network namespace integration; invoked by test-stealth-linux.sh."""
import os
import signal
import subprocess
import time
from openpath.stealth import StealthBridge


def run(*args):
    return subprocess.run(args, check=True, text=True, capture_output=True).stdout.strip()

bridge = StealthBridge()
try:
    port = bridge.start('wss://198.51.100.1:18443', 'ci-test', 'only-for-disposable-ci-tests-not-production-123')
    run('ip', 'link', 'add', 'opvpn0', 'type', 'wireguard')
    run('ip', 'address', 'add', '10.203.0.2/32', 'dev', 'opvpn0')
    run('wg', 'set', 'opvpn0', 'private-key', os.environ['CLIENT_KEY'], 'fwmark', '51820',
        'peer', os.environ['SERVER_PUBLIC'], 'endpoint', f'127.0.0.1:{port}',
        'allowed-ips', '0.0.0.0/0,::/0', 'persistent-keepalive', '2')
    run('ip', 'link', 'set', 'opvpn0', 'up')
    # Mirror wg-quick's default-route policy; no global host-route exception.
    run('ip', 'route', 'add', 'default', 'dev', 'opvpn0', 'table', '51820')
    run('ip', 'rule', 'add', 'not', 'fwmark', '51820', 'table', '51820')
    run('ip', 'rule', 'add', 'table', 'main', 'suppress_prefixlength', '0')
    assert 'dev opvpn0' in run('ip', 'route', 'get', '198.51.100.1')
    assert 'dev ceth' in run('ip', 'route', 'get', '198.51.100.1', 'oif', 'ceth')
    print(run('ping', '-c', '3', '-W', '4', '198.18.0.1'), flush=True)
    assert int(run('wg', 'show', 'opvpn0', 'latest-handshakes').split()[-1]) > 0
    assert bridge.status() == 'connected'
    # If the relay dies, its UDP endpoint remains loopback; direct UDP must not
    # be restored or substituted. We deliberately leave the WG interface up.
    os.kill(int(os.environ['RELAY_PID']), signal.SIGTERM)
    deadline = time.monotonic() + 10
    while bridge.status() == 'connected' and time.monotonic() < deadline:
        time.sleep(.05)
    assert bridge.status() == 'failed', bridge.status()
    assert '127.0.0.1:' in run('wg', 'show', 'opvpn0', 'endpoints')
    assert subprocess.run(['ping', '-c', '1', '-W', '2', '198.18.0.1'], capture_output=True).returncode != 0
    print('Linux kernel WireGuard handshake and tunneled ICMP over verified TLS; relay failure had no direct fallback.', flush=True)
finally:
    subprocess.run(['ip', 'link', 'delete', 'opvpn0'], check=False, capture_output=True)
    bridge.stop()
