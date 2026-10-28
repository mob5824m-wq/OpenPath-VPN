# PyInstaller build of the Qt Widgets application; intentionally no web engine.
import os
import sys
from pathlib import Path

from PyInstaller.utils.hooks import copy_metadata

native = Path(SPECPATH)
root = native.parents[1]
icon_dir = native / "build" / "icons"
if sys.platform == "win32":
    icon = icon_dir / "OpenPath.ico"
    backends = ["keyring.backends.Windows", "win32ctypes.pywin32.win32cred"]
elif sys.platform == "darwin":
    icon = icon_dir / "OpenPath.icns"
    backends = ["keyring.backends.macOS", "keyring.backends.macOS.api"]
else:
    icon = root / "assets" / "icon-512.png"
    backends = ["keyring.backends.SecretService", "secretstorage", "jeepney"]

analysis = Analysis(
    [str(native / "entry.py")],
    pathex=[str(native)],
    binaries=[],
    datas=[(str(root / "assets" / "icon-512.png"), "assets")] + copy_metadata("keyring"),
    hiddenimports=backends,
    excludes=["PySide6.QtWebEngineCore", "PySide6.QtWebEngineWidgets", "PySide6.QtWebChannel"],
    noarchive=False,
)
pyz = PYZ(analysis.pure)
exe = EXE(
    pyz, analysis.scripts, [], exclude_binaries=True, name="OpenPath",
    icon=str(icon), console=False, debug=False, strip=False, upx=False,
)
collection = COLLECT(exe, analysis.binaries, analysis.datas, name="OpenPath", strip=False, upx=False)
if sys.platform == "darwin":
    app = BUNDLE(
        collection, name="OpenPath.app", icon=str(icon),
        bundle_identifier="com.openpath.vpn",
        info_plist={
            "CFBundleName": "OpenPath",
            "CFBundleDisplayName": "OpenPath VPN",
            "CFBundleShortVersionString": os.environ.get("OPENPATH_VERSION", "1.0.0"),
            "CFBundleVersion": os.environ.get("OPENPATH_VERSION", "1.0.0"),
            "NSHighResolutionCapable": True,
        },
    )
