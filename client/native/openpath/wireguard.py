"""Validated, administrator-authorized WireGuard integration for native clients.

The WebSocket demo is deliberately not used here. A WireGuard profile belongs
in the OS credential store, and only sanitized configuration reaches wg-quick
or the official Windows tunnel service.
"""
from __future__ import annotations

import base64
import binascii
import contextlib
from dataclasses import dataclass
import ipaddress
import json
import ntpath
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import tempfile
import threading
from typing import Any, Callable

NAME = "opvpn0"
SERVICE = "OpenPath WireGuard"
ACCOUNT = "device-profile"
DNS = {
    "unfiltered": ("1.1.1.1", "1.0.0.1"),
    "malware": ("9.9.9.9", "149.112.112.112"),
    "ads": ("94.140.14.14", "94.140.15.15"),
}
KEY_RE = re.compile(r"[A-Za-z0-9+/]{43}=\Z")
HOST_LABEL = re.compile(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\Z")


@dataclass(frozen=True)
class Profile:
    private_key: str
    addresses: tuple[str, ...]
    dns: tuple[str, ...]
    public_key: str
    endpoint: str
    preshared_key: str | None = None
    mtu: str | None = None
    listen_port: str | None = None
    keepalive: str = "25"


def _key(value: str, name: str) -> str:
    try:
        raw = base64.b64decode(value, validate=True)
    except (ValueError, binascii.Error):
        raw = b""
    if not KEY_RE.fullmatch(value) or len(raw) != 32 or base64.b64encode(raw).decode() != value:
        raise ValueError(f"{name} must be a valid 32-byte WireGuard key")
    return value


def _ip_list(value: str, label: str) -> tuple[str, ...]:
    parts = tuple(part.strip() for part in value.split(",") if part.strip())
    try:
        if not parts:
            raise ValueError()
        # Zone identifiers have platform-dependent behavior and are not portable.
        if any("%" in part for part in parts):
            raise ValueError()
        for part in parts:
            ipaddress.ip_address(part)
    except ValueError as error:
        raise ValueError(f"{label} must contain IP addresses separated by commas") from error
    return parts


def _addresses(value: str) -> tuple[str, ...]:
    parts = tuple(part.strip() for part in value.split(",") if part.strip())
    try:
        if not parts or any("/" not in part or "%" in part for part in parts):
            raise ValueError()
        parsed = [ipaddress.ip_interface(part) for part in parts]
        if not any(item.version == 4 for item in parsed):
            raise ValueError("An IPv4 interface address is required")
    except ValueError as error:
        raise ValueError("Address must contain valid IP addresses with CIDR prefixes, including IPv4") from error
    return parts


def _endpoint(value: str) -> str:
    match = re.fullmatch(r"(?:\[([0-9a-fA-F:]+)\]|([A-Za-z0-9.-]+)):(\d{1,5})", value)
    if not match or not 1 <= int(match.group(3)) <= 65535:
        raise ValueError("Endpoint must be a host or [IPv6 address] followed by a UDP port")
    ipv6, host, _ = match.groups()
    if ipv6:
        try:
            ipaddress.IPv6Address(ipv6)
        except ValueError as error:
            raise ValueError("Endpoint IPv6 address is invalid") from error
    if host:
        try:
            ipaddress.ip_address(host)
        except ValueError:
            if len(host) > 253 or any(not HOST_LABEL.fullmatch(part) for part in host.split(".")):
                raise ValueError("Endpoint hostname is invalid")
    return value


def _number(value: str | None, name: str, minimum: int, maximum: int) -> str | None:
    if value is not None and (not re.fullmatch(r"[0-9]+", value) or not minimum <= int(value) <= maximum):
        raise ValueError(f"{name} is out of range")
    return value


def parse_config(text: str) -> Profile:
    if not isinstance(text, str) or len(text.encode("utf-8")) > 65536:
        raise ValueError("WireGuard configuration is missing or too large")
    sections: dict[str, dict[str, str]] = {"interface": {}, "peer": {}}
    allowed = {
        "interface": {"privatekey", "address", "dns", "mtu", "listenport"},
        "peer": {"publickey", "presharedkey", "endpoint", "allowedips", "persistentkeepalive"},
    }
    section = ""
    seen_interface = seen_peer = False
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        header = re.fullmatch(r"\[(interface|peer)\]", line, re.I)
        if header:
            section = header.group(1).lower()
            if section == "interface":
                if seen_interface or seen_peer:
                    raise ValueError("A profile must have one Interface followed by one Peer")
                seen_interface = True
            else:
                if not seen_interface or seen_peer:
                    raise ValueError("A profile must have one Interface followed by one Peer")
                seen_peer = True
            continue
        pair = re.fullmatch(r"([A-Za-z]+)\s*=\s*(.+)", line)
        if not section or not pair:
            raise ValueError("Invalid WireGuard configuration line")
        key, value = pair.group(1).lower(), pair.group(2).strip()
        if key not in allowed[section]:
            raise ValueError(f"Unsupported or unsafe WireGuard directive: {pair.group(1)}")
        if key in sections[section]:
            raise ValueError(f"Duplicate WireGuard directive: {pair.group(1)}")
        sections[section][key] = value
    interface, peer = sections["interface"], sections["peer"]
    if not seen_interface or not seen_peer:
        raise ValueError("A WireGuard profile needs one Interface and one Peer")
    if not all((interface.get("privatekey"), interface.get("address"), peer.get("publickey"), peer.get("endpoint"), peer.get("allowedips"))):
        raise ValueError("Profile needs PrivateKey, Address, PublicKey, Endpoint and AllowedIPs")
    routes = [part.strip() for part in peer["allowedips"].split(",")]
    if len(routes) != 2 or set(routes) != {"0.0.0.0/0", "::/0"}:
        raise ValueError("A device-wide profile must route both 0.0.0.0/0 and ::/0 through the peer")
    return Profile(
        private_key=_key(interface["privatekey"], "PrivateKey"),
        addresses=_addresses(interface["address"]),
        dns=_ip_list(interface["dns"], "DNS") if interface.get("dns") else (),
        public_key=_key(peer["publickey"], "PublicKey"),
        endpoint=_endpoint(peer["endpoint"]),
        preshared_key=_key(peer["presharedkey"], "PresharedKey") if peer.get("presharedkey") else None,
        mtu=_number(interface.get("mtu"), "MTU", 576, 9000),
        listen_port=_number(interface.get("listenport"), "ListenPort", 0, 65535),
        keepalive=_number(peer.get("persistentkeepalive"), "PersistentKeepalive", 0, 65535) or "25",
    )


def dns_for(profile: Profile, options: dict[str, str] | None = None) -> tuple[str, ...]:
    options = options or {}
    mode = options.get("dnsMode", "unfiltered")
    if mode not in ("unfiltered", "malware", "ads", "custom"):
        raise ValueError("Select a valid DNS filter mode")
    return _ip_list(str(options.get("customDns", "")), "Custom DNS") if mode == "custom" else (
        profile.dns if mode == "unfiltered" and profile.dns else DNS[mode]
    )


def render_config(profile: Profile, options: dict[str, str] | None = None) -> str:
    dns = dns_for(profile, options)
    lines = ["[Interface]", f"PrivateKey = {profile.private_key}", f"Address = {', '.join(profile.addresses)}", f"DNS = {', '.join(dns)}"]
    if profile.mtu is not None:
        lines.append(f"MTU = {profile.mtu}")
    if profile.listen_port is not None:
        lines.append(f"ListenPort = {profile.listen_port}")
    lines.extend(("", "[Peer]", f"PublicKey = {profile.public_key}"))
    if profile.preshared_key:
        lines.append(f"PresharedKey = {profile.preshared_key}")
    lines.extend((f"Endpoint = {profile.endpoint}", "AllowedIPs = 0.0.0.0/0, ::/0", f"PersistentKeepalive = {profile.keepalive}", ""))
    return "\n".join(lines)


class NativeKeychain:
    """Use the operating system's secure credential store, not plaintext fallbacks."""
    def __init__(self, platform: str = sys.platform):
        self.platform = platform

    def _backend(self):
        try:
            if self.platform == "win32":
                from keyring.backends.Windows import WinVaultKeyring
                backend = WinVaultKeyring()
            elif self.platform == "darwin":
                from keyring.backends.macOS import Keyring
                backend = Keyring()
            elif self.platform.startswith("linux"):
                from keyring.backends.SecretService import Keyring
                backend = Keyring()
            else:
                raise RuntimeError("Unsupported operating system")
            if backend.priority <= 0:
                raise RuntimeError("Secure credential store is unavailable")
            return backend
        except Exception as error:
            raise RuntimeError("A working system keychain is required to save the WireGuard profile securely") from error

    def read(self) -> dict[str, Any]:
        try:
            value = self._backend().get_password(SERVICE, ACCOUNT)
            if not value:
                raise ValueError("Import a WireGuard profile first")
            data = json.loads(value)
            if not isinstance(data, dict):
                raise ValueError("Invalid profile in keychain")
            return data
        except ValueError:
            raise
        except Exception as error:
            raise RuntimeError(f"Could not unlock the saved profile: {clean_error(error)}") from error

    def write(self, data: dict[str, Any]) -> None:
        value = json.dumps(data, separators=(",", ":"))
        # Windows Credential Manager limits generic credentials to 2,560 bytes.
        if self.platform == "win32" and len(value.encode("utf-16-le")) > 2560:
            raise ValueError("The sanitized profile is too large for Windows Credential Manager")
        try:
            self._backend().set_password(SERVICE, ACCOUNT, value)
        except Exception as error:
            raise RuntimeError(f"Could not store the profile in the system keychain: {clean_error(error)}") from error

    def remove(self) -> None:
        try:
            backend = self._backend()
            if backend.get_password(SERVICE, ACCOUNT) is not None:
                backend.delete_password(SERVICE, ACCOUNT)
        except Exception as error:
            raise RuntimeError(f"Could not remove the saved profile: {clean_error(error)}") from error


def clean_error(error: BaseException | str) -> str:
    return re.sub(r"[A-Za-z0-9+/]{43}=", "[key hidden]", str(error)).strip()[-500:] or "Unknown error"


def run_command(args: list[str], *, env: dict[str, str] | None = None, timeout: int = 120) -> str:
    merged = {**os.environ, "LC_ALL": "C", **(env or {})}
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=timeout, env=merged, check=False,
                                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except (OSError, subprocess.TimeoutExpired) as error:
        raise RuntimeError(clean_error(error)) from error
    if result.returncode:
        raise RuntimeError(clean_error(result.stderr or result.stdout or f"Command exited {result.returncode}"))
    return result.stdout.strip()


def find_tool(candidates: list[str]) -> str | None:
    return next((path for path in candidates if os.path.isfile(path) and os.access(path, os.X_OK)), None)


def apple_script_command(tool: str, action: str, config_path: str) -> str:
    search = ":".join((os.path.dirname(tool), "/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"))
    command = " ".join(shlex.quote(value) for value in ("/usr/bin/env", f"PATH={search}", tool, action, config_path))
    return f"do shell script {json.dumps(command, ensure_ascii=False)} with administrator privileges"


def _remove(path: Path) -> None:
    try:
        path.unlink()
    except FileNotFoundError:
        pass


class DeviceVPN:
    def __init__(self, storage_path: str | Path, *, platform: str = sys.platform, keychain: Any = None,
                 run: Callable[..., str] = run_command, find: Callable[[list[str]], str | None] = find_tool,
                 wireguard_dir: str | Path = "/var/run/wireguard"):
        self.platform = platform
        self.keychain = keychain or NativeKeychain(platform)
        self.run = run
        self.find = find
        self.wireguard_dir = Path(wireguard_dir)
        self.directory = Path(storage_path) / "device-vpn"
        self.metadata = self.directory / "profile.json"
        self.marker = self.directory / "active.json"
        self.windows_config = self.directory / f"{NAME}.conf"
        self._operation = threading.Lock()

    @contextlib.contextmanager
    def locked(self):
        if not self._operation.acquire(blocking=False):
            raise RuntimeError("Another device VPN operation is already in progress")
        try:
            yield
        finally:
            self._operation.release()

    def init_dir(self) -> None:
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        if self.platform != "win32":
            self.directory.chmod(0o700)
            return
        # Replace the complete DACL, not just inherited grants. The Windows
        # service runs as SYSTEM; the current user must also manage the files.
        script = "; ".join((
            "$ErrorActionPreference='Stop'",
            '$acl=New-Object System.Security.AccessControl.DirectorySecurity',
            '$acl.SetAccessRuleProtection($true,$false)',
            '$user=[System.Security.Principal.WindowsIdentity]::GetCurrent().User',
            "$system=New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18')",
            "$inherit=[System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'",
            '$propagation=[System.Security.AccessControl.PropagationFlags]::None',
            '$type=[System.Security.AccessControl.AccessControlType]::Allow',
            "foreach($sid in @($user,$system)){ $rule=New-Object System.Security.AccessControl.FileSystemAccessRule($sid,'FullControl',$inherit,$propagation,$type); $acl.AddAccessRule($rule) }",
            '[System.IO.Directory]::SetAccessControl($env:OPVPN_DIRECTORY,$acl)',
        ))
        self.run([self.windows_tool("powershell"), "-NoProfile", "-NonInteractive", "-Command", script], env={"OPVPN_DIRECTORY": str(self.directory)})

    def _write(self, target: Path, data: str) -> None:
        # The directory was restricted before calling. Avoid overwriting a stale
        # Windows file with an old, explicitly permissive ACL.
        _remove(target)
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
        descriptor = os.open(target, flags, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as out:
            out.write(data)

    def _profile(self) -> tuple[Profile, dict[str, str]]:
        data = self.keychain.read()
        return parse_config(data.get("config")), data.get("options") or {"dnsMode": "unfiltered"}

    def windows_tool(self, name: str) -> str:
        root = os.environ.get("SystemRoot", r"C:\Windows")
        candidates = [ntpath.join(os.environ.get("ProgramFiles", r"C:\Program Files"), "WireGuard", "wireguard.exe")] if name == "wireguard" else [
            ntpath.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
        ]
        tool = self.find(candidates)
        if not tool:
            raise RuntimeError("Install the official WireGuard for Windows app first" if name == "wireguard" else "PowerShell is not available on this Windows system")
        return tool

    def wg_quick(self) -> str:
        candidates = ["/opt/homebrew/bin/wg-quick", "/usr/local/bin/wg-quick", "/opt/local/bin/wg-quick"] if self.platform == "darwin" else ["/usr/bin/wg-quick", "/usr/local/bin/wg-quick", "/bin/wg-quick"]
        tool = self.find(candidates)
        if not tool:
            raise RuntimeError("Install WireGuard tools (wg and wg-quick) before connecting")
        return tool

    def runtime_status(self) -> dict[str, str]:
        try:
            if self.platform.startswith("linux"):
                ip = self.find(["/usr/sbin/ip", "/usr/bin/ip", "/sbin/ip", "/bin/ip"])
                if not ip:
                    return {"state": "unknown", "message": "iproute2 is required to inspect the VPN interface"}
                try:
                    output = self.run([ip, "-o", "link", "show", "dev", NAME])
                    match = re.match(rf"\s*(\d+):\s+{re.escape(NAME)}(?:@[^:]+)?:", output)
                    if not match:
                        return {"state": "unknown", "message": "Could not identify the VPN interface"}
                    return {"state": "active", "identity": f"ifindex:{match.group(1)}"}
                except Exception as error:
                    if re.search(r"does not exist|cannot find device|not found", clean_error(error), re.I):
                        return {"state": "inactive"}
                    return {"state": "unknown", "message": "Could not inspect the VPN interface"}
            if self.platform == "darwin":
                try:
                    interface = (self.wireguard_dir / f"{NAME}.name").read_text(encoding="utf-8").strip()
                except FileNotFoundError:
                    return {"state": "inactive"}
                if not re.fullmatch(r"utun\d+", interface):
                    return {"state": "unknown", "message": "Invalid WireGuard interface name"}
                try:
                    self.run(["/sbin/ifconfig", interface])
                    return {"state": "active", "identity": f"utun:{interface}"}
                except Exception as error:
                    if re.search(r"does not exist|not found", clean_error(error), re.I):
                        return {"state": "inactive"}
                    return {"state": "unknown", "message": "Could not inspect the WireGuard interface"}
            if self.platform == "win32":
                script = "$ErrorActionPreference='Stop'; try { (Get-Service -Name 'WireGuardTunnel$opvpn0' -ErrorAction Stop).Status.ToString() } catch { if ($_.FullyQualifiedErrorId -like 'NoServiceFoundForGivenName*') {'absent'} else {throw} }"
                state = self.run([self.windows_tool("powershell"), "-NoProfile", "-NonInteractive", "-Command", script]).strip().lower()
                if state == "running":
                    return {"state": "active", "identity": "service:opvpn0"}
                if state == "absent":
                    return {"state": "inactive"}
                if state == "stopped":
                    return {"state": "stopped", "identity": "service:opvpn0", "message": "WireGuard service stopped; disconnect to remove it."}
                return {"state": "unknown", "message": f"WireGuard service is {state or 'not responding'}"}
            return {"state": "unsupported", "message": "Device VPN is supported on Linux, macOS and Windows"}
        except Exception as error:
            return {"state": "unknown", "message": clean_error(error)}

    def status(self) -> dict[str, Any]:
        runtime = self.runtime_status()
        configured, owned = self.metadata.is_file(), False
        if runtime.get("identity"):
            try:
                record = json.loads(self.marker.read_text(encoding="utf-8"))
                owned = isinstance(record, dict) and record.get("identity") == runtime["identity"]
            except (OSError, ValueError):
                pass
        try:
            if self.platform == "win32":
                self.windows_tool("wireguard")
            elif self.platform == "darwin" or self.platform.startswith("linux"):
                self.wg_quick()
            else:
                raise RuntimeError("Unsupported")
            installed = True
        except Exception:
            installed = False
        message = runtime.get("message", "")
        if not owned and runtime["state"] in ("active", "stopped"):
            message = "This interface is not confirmed as OpenPath-owned. Inspect it using its original WireGuard client."
        elif runtime["state"] == "active" and not message:
            message = "Interface active; peer connectivity is not yet verified."
        endpoint = ""
        if configured:
            try:
                endpoint = str(json.loads(self.metadata.read_text(encoding="utf-8")).get("endpoint", ""))[:253]
            except (OSError, ValueError, AttributeError):
                pass
        return {**runtime, "configured": configured, "owned": owned, "installed": installed, "interface": NAME,
                "message": message, "endpoint": endpoint}

    def import_file(self, filename: str | Path) -> dict[str, Any]:
        with self.locked():
            if self.runtime_status()["state"] != "inactive":
                raise RuntimeError("Disconnect the device VPN before replacing its profile")
            source = Path(filename)
            if not source.is_file():
                raise ValueError("Select a WireGuard .conf file smaller than 64 KB")
            with source.open("rb") as stream:
                content = stream.read(65537)
            if len(content) > 65536:
                raise ValueError("Select a WireGuard .conf file smaller than 64 KB")
            try:
                profile = parse_config(content.decode("utf-8-sig"))
            except UnicodeDecodeError as error:
                raise ValueError("WireGuard profile must be UTF-8 text") from error
            config = render_config(profile, {"dnsMode": "unfiltered"})
            self.init_dir()
            self.keychain.write({"config": config, "options": {"dnsMode": "unfiltered"}})
            self._write(self.metadata, json.dumps({"endpoint": profile.endpoint}))
            return {"configured": True, "endpoint": profile.endpoint,
                    "hasIPv6Address": any(ipaddress.ip_interface(address).version == 6 for address in profile.addresses)}

    def remove_profile(self) -> dict[str, bool]:
        with self.locked():
            if self.runtime_status()["state"] != "inactive":
                raise RuntimeError("Disconnect the device VPN before removing its profile")
            self.keychain.remove()
            for item in (self.metadata, self.marker, self.windows_config):
                _remove(item)
            return {"ok": True}

    @contextlib.contextmanager
    def temp_config(self, config: str):
        self.init_dir()
        with tempfile.TemporaryDirectory(prefix="wg-", dir=self.directory) as directory:
            os.chmod(directory, 0o700)
            filename = Path(directory) / f"{NAME}.conf"
            self._write(filename, config)
            yield str(filename)

    def elevated(self, action: str, config_path: str) -> str:
        if self.platform.startswith("linux"):
            tool = self.wg_quick()
            if hasattr(os, "geteuid") and os.geteuid() == 0:
                return self.run([tool, action, config_path])
            pkexec = self.find(["/usr/bin/pkexec", "/bin/pkexec"])
            if not pkexec:
                raise RuntimeError("Install polkit/pkexec to authorize WireGuard changes")
            return self.run([pkexec, tool, action, config_path])
        if self.platform == "darwin":
            return self.run(["/usr/bin/osascript", "-e", apple_script_command(self.wg_quick(), action, config_path)])
        if self.platform == "win32":
            operation = "/installtunnelservice" if action == "up" else "/uninstalltunnelservice"
            argument = config_path if action == "up" else NAME
            script = "$ErrorActionPreference='Stop'; $a=@($env:OPVPN_ACTION, ('\"'+$env:OPVPN_ARGUMENT+'\"')); $p=Start-Process -FilePath $env:OPVPN_PROGRAM -ArgumentList $a -Verb RunAs -Wait -PassThru; if($null -eq $p){throw 'No elevated process started'}; exit [int]$p.ExitCode"
            return self.run([self.windows_tool("powershell"), "-NoProfile", "-NonInteractive", "-Command", script], env={
                "OPVPN_ACTION": operation, "OPVPN_ARGUMENT": argument, "OPVPN_PROGRAM": self.windows_tool("wireguard")})
        raise RuntimeError("This operating system is not supported by the device VPN")

    def connect(self, options: dict[str, str] | None = None) -> dict[str, Any]:
        with self.locked():
            current = self.status()
            if current["state"] != "inactive":
                raise RuntimeError(current.get("message") or "The device VPN interface already exists")
            profile, _ = self._profile()
            options = options or {}
            safe_options = {"dnsMode": str(options.get("dnsMode", "unfiltered")), "customDns": str(options.get("customDns", ""))}
            config = render_config(profile, safe_options)
            self.init_dir()
            _remove(self.marker)
            started = False
            try:
                if self.platform == "win32":
                    self._write(self.windows_config, config)
                    self.elevated("up", str(self.windows_config))
                else:
                    with self.temp_config(config) as filename:
                        self.elevated("up", filename)
                started = True
                runtime = self.runtime_status()
                if runtime["state"] != "active" or not runtime.get("identity"):
                    raise RuntimeError(runtime.get("message") or "WireGuard did not report an active interface")
                # DNS is not secret. The interface identity helps avoid treating
                # a later, unrelated interface as the one we started.
                self._write(self.marker, json.dumps({"interface": NAME, "identity": runtime["identity"],
                                                     "dns": dns_for(profile, safe_options)}))
                result = self.status()
                if result["state"] != "active" or not result["owned"]:
                    raise RuntimeError(result.get("message") or "WireGuard did not report an active interface")
                return result
            except Exception as error:
                runtime = self.runtime_status()
                if runtime["state"] == "inactive":
                    _remove(self.marker)
                    _remove(self.windows_config)
                elif not started:
                    _remove(self.marker)
                raise RuntimeError(f"Could not start WireGuard: {clean_error(error)}") from error

    def disconnect(self) -> dict[str, Any]:
        with self.locked():
            current = self.status()
            if current["state"] == "inactive":
                _remove(self.marker)
                _remove(self.windows_config)
                return self.status()
            if not current["owned"]:
                raise RuntimeError("This interface was not started by OpenPath; stop it with its original client")
            if current["state"] not in ("active", "stopped"):
                raise RuntimeError(current.get("message") or "Could not verify device VPN status")
            try:
                if self.platform == "win32":
                    self.elevated("down", str(self.windows_config))
                else:
                    # Down only needs DNS to remove wg-quick's resolver entry.
                    # It should work even if the user's keychain is now locked.
                    marker = json.loads(self.marker.read_text(encoding="utf-8"))
                    values = marker.get("dns") if isinstance(marker, dict) else None
                    if not isinstance(values, list) or not all(isinstance(value, str) for value in values):
                        raise RuntimeError("The VPN ownership record is invalid; inspect the interface manually")
                    addresses = _ip_list(", ".join(values), "Saved DNS")
                    with self.temp_config(f"[Interface]\nDNS = {', '.join(addresses)}\n") as filename:
                        self.elevated("down", filename)
            except Exception as error:
                raise RuntimeError(f"Could not stop WireGuard: {clean_error(error)}") from error
            if self.runtime_status()["state"] != "inactive":
                raise RuntimeError("WireGuard did not confirm that the interface or service was removed")
            _remove(self.marker)
            _remove(self.windows_config)
            return self.status()
