"""Actual Qt Widgets controls exercised offscreen with injected platform operations."""
import os
import sys
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
try:
    from PySide6.QtCore import QSettings, Qt
    from PySide6.QtWidgets import QApplication, QFileDialog
    from openpath.app import MainWindow
    HAVE_QT = True
except ImportError:
    HAVE_QT = False


class FakeVPN:
    def __init__(self):
        self.active = False
        self.configured = True
        self.options = None
        self.failure = ""

    def status(self):
        return {"state": "active" if self.active else "inactive", "owned": self.active,
                "configured": self.configured, "installed": True, "endpoint": "vpn.example.com:51820" if self.configured else None}

    def connect(self, options):
        if self.failure:
            raise RuntimeError(self.failure)
        self.options = options
        self.active = True
        return self.status()

    def disconnect(self):
        self.active = False
        return self.status()

    def import_file(self, path):
        self.configured = True
        self.imported = path
        return {"endpoint": "vpn.example.com:51820", "hasIPv6Address": True}

    def remove_profile(self):
        self.configured = False
        return self.status()


class FakeSession:
    def __init__(self):
        self.state = "disconnected"
        self.calls = []

    def status(self):
        return {"state": self.state, "message": "Device traffic is not routed."}

    def begin(self):
        self.state = "connecting"
        return 1

    def connect(self, server, username, psk, mode, generation):
        self.calls.append((server, username, psk, mode, generation))
        self.state = "connected"
        return self.status()

    def cancel(self):
        self.state = "disconnected"
        return None

    def close_socket(self, _socket):
        pass

    def disconnect(self):
        self.cancel()
        return self.status()

    def fetch(self, address):
        return {"status": 200, "body": f"Fetched {address}", "truncated": False}


class FakeFeed:
    def load(self, force=False):
        self.force = force
        return {"releases": [{"tag": "v1.2", "url": "https://github.com/mob5824m-wq/OpenPath-VPN/releases/tag/v1.2", "assets": [
            {"name": "OpenPath-v1.2-win-x64.zip", "url": "https://github.com/mob5824m-wq/OpenPath-VPN/releases/download/v1.2/win.zip"},
            {"name": "OpenPath-v1.2-linux-x64.deb", "url": "https://github.com/mob5824m-wq/OpenPath-VPN/releases/download/v1.2/linux.deb"},
        ]}], "stale": False}


@unittest.skipUnless(HAVE_QT, "PySide6 and system Qt libraries are required")
class UITests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.vpn = FakeVPN()
        self.feed = FakeFeed()
        self.session = FakeSession()
        self.opened = []
        self.settings = QSettings(str(Path(self.temp.name) / "settings.ini"), QSettings.Format.IniFormat)
        directory = lambda _server: [{"name": "Configured server", "url": "wss://main.example/ops", "country": "", "region": ""},
                                     {"name": "Toronto", "url": "wss://ca.example/ops", "country": "CA", "region": "Toronto"}]
        self.window = MainWindow(vpn=self.vpn, feed=self.feed, session=self.session, directory=directory, settings=self.settings,
                                 launch_url=lambda url: self.opened.append(url) or True, auto_refresh=False)
        self.window.show()
        self.window.refresh_status()
        self.wait_for(lambda: not self.window.status_busy)

    def tearDown(self):
        self.window.close()
        self.app.processEvents()
        self.temp.cleanup()

    def wait_for(self, condition):
        deadline = time.monotonic() + 4
        while time.monotonic() < deadline:
            self.app.processEvents()
            if condition():
                return
            time.sleep(0.01)
        self.fail("Timed out waiting for a UI operation")

    def wait_for_device(self):
        self.wait_for(lambda: not self.window.device_busy and not self.window.status_busy)

    def test_adaptive_navigation_keeps_controls_working(self):
        w = self.window
        w.resize(1100, 760)
        self.app.processEvents()
        self.assertTrue(w._wide_layout)
        self.assertLess(w.navigation.geometry().right(), w.stack.geometry().left())
        self.assertLess(w.nav_buttons[0].geometry().top(), w.nav_buttons[-1].geometry().top())
        w.nav_buttons[4].click()
        self.assertEqual(w.stack.currentIndex(), 4)
        w.resize(400, 720)
        self.app.processEvents()
        self.assertFalse(w._wide_layout)
        self.assertGreater(w.navigation.geometry().top(), w.stack.geometry().bottom())
        self.assertLess(w.nav_buttons[0].geometry().left(), w.nav_buttons[-1].geometry().left())
        w.nav_buttons[0].click()
        self.assertEqual(w.stack.currentIndex(), 0)

    def test_real_controls_connect_disconnect_import_remove_and_errors(self):
        w = self.window
        self.assertEqual(w.status_label.text(), "Device VPN disconnected")
        w.dns_mode.setCurrentIndex(w.dns_mode.findData("custom"))
        w.custom_dns.setText("1.1.1.1, 9.9.9.9")
        w.connect_button.click()
        self.wait_for_device()
        self.assertEqual(self.vpn.options, {"dnsMode": "custom", "customDns": "1.1.1.1, 9.9.9.9"})
        self.assertEqual(w.status_label.text(), "WireGuard interface active")
        self.assertFalse(w.connect_button.isEnabled())
        self.assertTrue(w.disconnect_button.isEnabled())
        w.disconnect_button.click()
        self.wait_for_device()
        self.assertEqual(w.status_label.text(), "Device VPN disconnected")
        self.vpn.failure = "Permission denied"
        w.connect_button.click()
        self.wait_for_device()
        self.assertIn("Permission denied", w.device_message.text())
        self.assertFalse(self.vpn.active)
        self.vpn.failure = ""
        w.profile_remove.click()
        self.wait_for_device()
        self.assertFalse(self.vpn.configured)
        self.assertFalse(w.connect_button.isEnabled())
        with patch.object(QFileDialog, "getOpenFileName", return_value=("/tmp/profile.conf", "")):
            w.profile_import.click()
        self.wait_for_device()
        self.assertEqual(self.vpn.imported, "/tmp/profile.conf")
        self.assertTrue(w.connect_button.isEnabled())

    def test_stealth_transport_uses_settings_without_persisting_psk(self):
        w = self.window
        w.server_input.setText("wss://relay.example/ops")
        w.user_input.setText("relay-user")
        w.psk_input.setText("relay-secret-in-memory")
        self.assertTrue(w.save_server_settings())
        w.vpn_transport.setCurrentIndex(w.vpn_transport.findData("stealth"))
        # A Windows acknowledgement dialog is required before the /1 routes.
        if sys.platform == "win32":
            from PySide6.QtWidgets import QMessageBox
            with patch.object(QMessageBox, "warning", return_value=QMessageBox.StandardButton.Yes):
                w.connect_button.click()
        else:
            w.connect_button.click()
        self.wait_for_device()
        self.assertEqual(self.vpn.options["transport"], "stealth")
        self.assertEqual(self.vpn.options["relayServer"], "wss://relay.example/ops")
        self.assertEqual(self.vpn.options["relayPsk"], "relay-secret-in-memory")
        if sys.platform == "win32":
            self.assertEqual(self.vpn.options["allowWindowsStealthWithoutKillSwitch"], "yes")
        self.settings.sync()
        self.assertNotIn("relay-secret-in-memory", Path(self.settings.fileName()).read_text())
        self.assertFalse(w.vpn_transport.isEnabled())
        w.disconnect_button.click()
        self.wait_for_device()
        self.assertTrue(w.vpn_transport.isEnabled())

    def test_session_settings_locations_connect_fetch_and_disconnect(self):
        w = self.window
        w.server_input.setText("wss://main.example/ops")
        w.user_input.setText("demo")
        w.psk_input.setText("do-not-persist-this-secret")
        self.assertTrue(w.save_server_settings())
        self.settings.sync()
        self.assertNotIn("do-not-persist-this-secret", Path(self.settings.fileName()).read_text())
        w.select_page(1)
        w.directory_button.click()
        self.wait_for(lambda: not w.directory_busy)
        self.assertEqual(w.session_targets.count(), 2)
        w.session_targets.setCurrentIndex(1)
        w.session_mode.setCurrentIndex(w.session_mode.findData("fast"))
        w.session_connect.click()
        self.wait_for(lambda: self.session.state == "connected" and w.fetch_button.isEnabled())
        self.assertEqual(self.session.calls[0][:4], ("wss://ca.example/ops", "demo", "do-not-persist-this-secret", "fast"))
        w.fetch_address.setText("https://example.org/")
        w.fetch_button.click()
        self.wait_for(lambda: not w.fetch_busy)
        self.assertIn("HTTP 200", w.fetch_result.toPlainText())
        w.session_disconnect.click()
        self.assertEqual(self.session.state, "disconnected")
        self.assertFalse(w.fetch_button.isEnabled())

    def test_stale_status_does_not_override_completed_operation(self):
        w = self.window
        original_status = self.vpn.status
        entered, release = threading.Event(), threading.Event()
        first = [True]

        def delayed_status():
            result = original_status()
            if first[0]:
                first[0] = False
                entered.set()
                release.wait(3)
            return result

        self.vpn.status = delayed_status
        w.refresh_status()
        self.wait_for(entered.is_set)
        def connect(_options):
            self.vpn.active = True
            return original_status()
        self.vpn.connect = connect
        w.connect_button.click()
        self.wait_for(lambda: not w.device_busy)
        release.set()
        self.wait_for(lambda: not w.status_busy and w.status_label.text() == "WireGuard interface active")
        self.assertFalse(w.connect_button.isEnabled())

    def test_release_selection_filter_and_browser(self):
        w = self.window
        w.select_page(3)
        self.wait_for(lambda: not w.releases_busy)
        self.assertEqual(w.release_list.count(), 2)
        w.release_filter.setCurrentIndex(w.release_filter.findData("linux"))
        self.assertEqual(w.release_list.count(), 1)
        w.release_list.setCurrentRow(0)
        w.release_open.click()
        self.assertEqual(len(self.opened), 1)
        self.assertTrue(self.opened[0].endswith("linux.deb"))
        w.release_page.click()
        self.assertTrue(self.opened[-1].endswith("/tag/v1.2"))
        w.release_refresh.click()
        self.wait_for(lambda: not w.releases_busy)
        self.assertTrue(self.feed.force)
        w.release_filter.setCurrentIndex(w.release_filter.findData("macos"))
        self.assertEqual(w.release_list.count(), 0)
        self.assertIn("No assets", w.release_status.text())


if __name__ == "__main__":
    unittest.main()
