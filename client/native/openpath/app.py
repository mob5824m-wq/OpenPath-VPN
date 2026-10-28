"""Qt Widgets desktop app. No embedded browser, webview, or web server."""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Callable

from PySide6.QtCore import QObject, QRunnable, QSettings, QStandardPaths, QThreadPool, QTimer, Qt, QUrl, Signal
from PySide6.QtGui import QDesktopServices, QIcon
from PySide6.QtWidgets import (
    QApplication, QBoxLayout, QComboBox, QFileDialog, QFrame, QHBoxLayout, QLabel, QLineEdit,
    QListWidget, QListWidgetItem, QMainWindow, QMessageBox, QPlainTextEdit, QPushButton, QScrollArea, QStackedWidget,
    QVBoxLayout, QWidget,
)

from .releases import ReleaseFeed, matches, trusted_link
from .session import Session, fetch_directory, parse_server
from .wireguard import DeviceVPN, clean_error

STYLE = """
QMainWindow, QWidget { background: #09090f; color: #e5e7eb; font-family: Inter, Arial, sans-serif; font-size: 13px; }
QFrame#card { background: #15141e; border: 1px solid #302e3d; border-radius: 13px; }
QFrame#card QLabel { background: transparent; }
QLabel#title { font-size: 20px; font-weight: 800; color: #ffffff; }
QLabel#sectionTitle { font-size: 16px; font-weight: 700; color: #ffffff; }
QLabel#subtitle { color: #aaa8b9; font-size: 12px; }
QLabel#status { color: #d5d3e0; font-size: 15px; font-weight: 700; }
QLabel#message { color: #fbbf24; font-size: 12px; }
QPushButton { background: #262435; border: 1px solid #454257; border-radius: 8px; padding: 9px 12px; font-weight: 700; }
QPushButton:hover { background: #373248; }
QPushButton:disabled { color: #666372; background: #1b1a24; border-color: #2b2935; }
QPushButton#primary { background: #6d4aff; color: white; border-color: #866dff; }
QPushButton#primary:hover { background: #7b5cff; }
QPushButton#primary:disabled { background: #393054; color: #817a94; border-color: #393054; }
QFrame#navigation { background: #12101d; }
QPushButton#nav { border: 0; background: transparent; color: #bcbac8; padding: 10px 5px; }
QPushButton#nav:checked { color: white; background: #6d4aff; }
QComboBox, QLineEdit, QListWidget, QPlainTextEdit { background: #1b1a24; border: 1px solid #454257; border-radius: 7px; color: #f3f4f6; padding: 8px; }
QComboBox:disabled, QLineEdit:disabled { color: #6b6875; }
QListWidget::item { padding: 8px; border-bottom: 1px solid #302e3d; }
QListWidget::item:selected { background: #4e3c9d; }
QScrollArea, QScrollArea > QWidget > QWidget { border: 0; background: #09090f; }
"""


def label(text: str, name: str = "", *, wrap: bool = True) -> QLabel:
    item = QLabel(text)
    item.setTextFormat(Qt.TextFormat.PlainText)
    if name:
        item.setObjectName(name)
    item.setWordWrap(wrap)
    return item


def button(text: str, name: str = "") -> QPushButton:
    item = QPushButton(text)
    if name:
        item.setObjectName(name)
    item.setCursor(Qt.CursorShape.PointingHandCursor)
    return item


def card() -> tuple[QFrame, QVBoxLayout]:
    frame = QFrame()
    frame.setObjectName("card")
    layout = QVBoxLayout(frame)
    layout.setContentsMargins(15, 15, 15, 15)
    layout.setSpacing(9)
    return frame, layout


def page() -> tuple[QWidget, QVBoxLayout]:
    content = QWidget()
    layout = QVBoxLayout(content)
    layout.setContentsMargins(16, 16, 16, 16)
    layout.setSpacing(12)
    return content, layout


class JobSignals(QObject):
    finished = Signal(object, object)


class Job(QRunnable):
    def __init__(self, operation: Callable):
        super().__init__()
        self.operation = operation
        self.signals = JobSignals()

    def run(self):
        try:
            self.signals.finished.emit(self.operation(), None)
        except Exception as error:
            self.signals.finished.emit(None, clean_error(error))


class MainWindow(QMainWindow):
    def __init__(self, *, vpn=None, feed=None, session=None, directory=None, launch_url=None, settings=None, auto_refresh=True):
        super().__init__()
        self.setWindowTitle("OpenPath VPN")
        self.resize(1080, 760)
        self.setMinimumSize(360, 500)
        self.setStyleSheet(STYLE)
        self.settings = settings or QSettings()
        storage = QStandardPaths.writableLocation(QStandardPaths.StandardLocation.AppConfigLocation)
        self.vpn = vpn or DeviceVPN(storage)
        self.feed = feed or ReleaseFeed()
        self.session = session or Session()
        self.directory = directory or fetch_directory
        self.launch_url = launch_url or (lambda url: QDesktopServices.openUrl(QUrl(url)))
        self.pool = QThreadPool.globalInstance()
        self.jobs: set[Job] = set()
        self.device_busy = False
        self.device_revision = 0
        self.status_busy = False
        self.releases_busy = False
        self.directory_busy = False
        self.fetch_busy = False
        self.current_status = None
        self.releases = None
        self.release_warning = ""
        self._build()
        self.timer = QTimer(self)
        self.timer.setInterval(5000)
        self.timer.timeout.connect(self.refresh_status)
        self.session_timer = QTimer(self)
        self.session_timer.setInterval(1000)
        self.session_timer.timeout.connect(self.refresh_session)
        self.session_timer.start()
        if auto_refresh:
            self.refresh_status()
            self.timer.start()

    def _build(self):
        root = QWidget()
        self.setCentralWidget(root)
        outer = QVBoxLayout(root)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.setSpacing(0)
        header = QFrame()
        header.setObjectName("card")
        head = QHBoxLayout(header)
        head.setContentsMargins(18, 14, 18, 14)
        title = label("◈  OpenPath", "title")
        head.addWidget(title)
        head.addStretch()
        head.addWidget(label("WIREGUARD VPN", "subtitle"))
        outer.addWidget(header)
        self.body = QBoxLayout(QBoxLayout.Direction.TopToBottom)
        self.body.setContentsMargins(0, 0, 0, 0)
        self.body.setSpacing(0)
        outer.addLayout(self.body, 1)
        self.stack = QStackedWidget()
        self.body.addWidget(self.stack, 1)
        self._build_home()
        self._build_session()
        self._build_profiles()
        self._build_releases()
        self._build_settings()
        self._reset_targets()
        self.refresh_session()
        self.navigation = QFrame()
        self.navigation.setObjectName("navigation")
        self.nav_layout = QBoxLayout(QBoxLayout.Direction.LeftToRight, self.navigation)
        self.nav_layout.setContentsMargins(8, 8, 8, 8)
        self.nav_layout.setSpacing(4)
        self.nav_buttons = []
        for index, text in enumerate(("Home", "Session", "Profiles", "Releases", "Settings")):
            nav = button(text, "nav")
            nav.setCheckable(True)
            nav.clicked.connect(lambda _checked=False, i=index: self.select_page(i))
            self.nav_layout.addWidget(nav)
            self.nav_buttons.append(nav)
        self.body.addWidget(self.navigation)
        self._wide_layout = None
        self._update_layout()
        self.select_page(0)
        self._sync_controls()

    def resizeEvent(self, event):
        super().resizeEvent(event)
        if hasattr(self, "navigation"):
            self._update_layout()

    def _update_layout(self):
        wide = self.width() >= 760
        if wide == self._wide_layout:
            return
        self._wide_layout = wide
        self.body.removeWidget(self.navigation)
        if wide:
            self.body.setDirection(QBoxLayout.Direction.LeftToRight)
            self.nav_layout.setDirection(QBoxLayout.Direction.TopToBottom)
            self.nav_layout.setAlignment(Qt.AlignmentFlag.AlignTop)
            self.navigation.setMinimumWidth(190)
            self.navigation.setMaximumWidth(190)
            self.body.insertWidget(0, self.navigation)
        else:
            self.body.setDirection(QBoxLayout.Direction.TopToBottom)
            self.nav_layout.setDirection(QBoxLayout.Direction.LeftToRight)
            self.nav_layout.setAlignment(Qt.AlignmentFlag.AlignVCenter)
            self.navigation.setMinimumWidth(0)
            self.navigation.setMaximumWidth(16777215)
            self.body.addWidget(self.navigation)

    def _add_page(self, content):
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setAlignment(Qt.AlignmentFlag.AlignHCenter | Qt.AlignmentFlag.AlignTop)
        content.setMaximumWidth(1000)
        scroll.setWidget(content)
        self.stack.addWidget(scroll)

    def _build_home(self):
        content, layout = page()
        layout.addWidget(label("Device-wide VPN", "sectionTitle"))
        frame, box = card()
        self.status_label = label("Checking device VPN…", "status")
        self.status_label.setAccessibleName("Device VPN status")
        box.addWidget(self.status_label)
        self.status_detail = label("An active interface does not confirm a peer handshake.", "subtitle")
        box.addWidget(self.status_detail)
        self.endpoint_label = label("No WireGuard profile imported", "subtitle")
        box.addWidget(self.endpoint_label)
        self.import_button = button("Import WireGuard profile")
        self.import_button.clicked.connect(self.import_profile)
        box.addWidget(self.import_button)
        box.addWidget(label("Device VPN transport"))
        self.vpn_transport = QComboBox()
        self.vpn_transport.setAccessibleName("Device VPN transport")
        self.vpn_transport.addItem("Direct WireGuard (UDP)", "direct")
        self.vpn_transport.addItem("Stealth WireGuard over TLS/TCP", "stealth")
        box.addWidget(self.vpn_transport)
        box.addWidget(label("Stealth uses the server and PSK in Settings. It requires a configured WSS relay and keeps OpenPath running. No direct fallback; network changes may require reconnecting.", "subtitle"))
        box.addWidget(label("NetShield / DNS on next connection"))
        self.dns_mode = QComboBox()
        self.dns_mode.setAccessibleName("NetShield / DNS on next connection")
        for text, value in (("Malware, ads and trackers · AdGuard DNS", "ads"),
                            ("Malware only · Quad9", "malware"),
                            ("Unfiltered · profile DNS or Cloudflare", "unfiltered"),
                            ("Custom DNS", "custom")):
            self.dns_mode.addItem(text, value)
        saved = str(self.settings.value("dnsMode", "ads"))
        self.dns_mode.setCurrentIndex(max(0, self.dns_mode.findData(saved)))
        self.dns_mode.currentIndexChanged.connect(self._dns_changed)
        box.addWidget(self.dns_mode)
        self.custom_dns = QLineEdit(str(self.settings.value("customDns", "")))
        self.custom_dns.setAccessibleName("Custom DNS IP addresses")
        self.custom_dns.setPlaceholderText("Custom DNS IPs: 1.1.1.1, 1.0.0.1")
        self.custom_dns.textChanged.connect(lambda text: self.settings.setValue("customDns", text))
        box.addWidget(self.custom_dns)
        self.custom_dns.setVisible(self.dns_mode.currentData() == "custom")
        controls = QHBoxLayout()
        self.connect_button = button("Connect device VPN", "primary")
        self.connect_button.clicked.connect(self.connect_vpn)
        self.disconnect_button = button("Disconnect")
        self.disconnect_button.clicked.connect(self.disconnect_vpn)
        controls.addWidget(self.connect_button)
        controls.addWidget(self.disconnect_button)
        box.addLayout(controls)
        self.device_message = label("", "message")
        self.device_message.setAccessibleName("Device VPN message")
        box.addWidget(self.device_message)
        box.addWidget(label("Direct VPN stays active after the app closes. Stealth requires OpenPath to remain open. No general kill switch is provided; local routes or app-specific encrypted DNS may bypass filtering.", "subtitle"))
        layout.addWidget(frame)
        info, information = card()
        information.addWidget(label("Separate connection types", "sectionTitle"))
        information.addWidget(label("Direct VPN uses WireGuard UDP. Stealth wraps WireGuard in an authenticated HTTPS WebSocket over TLS/TCP. Both require a configured WireGuard server. The separate WebSocket session does not route device traffic.", "subtitle"))
        layout.addWidget(info)
        layout.addStretch()
        self._add_page(content)

    def _build_session(self):
        content, layout = page()
        layout.addWidget(label("WebSocket session", "sectionTitle"))
        frame, box = card()
        self.session_status = label("Session disconnected", "status")
        self.session_status.setAccessibleName("WebSocket session status")
        self.session_detail = label("Configure the server and credentials in Settings.", "subtitle")
        box.addWidget(self.session_status)
        box.addWidget(self.session_detail)
        box.addWidget(label("Server or advertised location"))
        self.session_targets = QComboBox()
        self.session_targets.setAccessibleName("Server or advertised location")
        box.addWidget(self.session_targets)
        self.directory_button = button("Refresh available locations")
        self.directory_button.clicked.connect(self.refresh_directory)
        box.addWidget(self.directory_button)
        self.directory_message = label("Only online servers advertised by your configured server are listed.", "subtitle")
        box.addWidget(self.directory_message)
        box.addWidget(label("Session mode"))
        self.session_mode = QComboBox()
        self.session_mode.setAccessibleName("WebSocket session mode")
        self.session_mode.addItem("Stealth · WebSocket", "stealth")
        self.session_mode.addItem("Fast · WebSocket", "fast")
        stored_mode = str(self.settings.value("sessionMode", "stealth"))
        self.session_mode.setCurrentIndex(max(0, self.session_mode.findData(stored_mode)))
        self.session_mode.currentIndexChanged.connect(lambda: self.settings.setValue("sessionMode", self.session_mode.currentData()))
        box.addWidget(self.session_mode)
        controls = QHBoxLayout()
        self.session_connect = button("Connect session", "primary")
        self.session_connect.clicked.connect(self.connect_session)
        self.session_disconnect = button("Disconnect")
        self.session_disconnect.clicked.connect(self.disconnect_session)
        controls.addWidget(self.session_connect)
        controls.addWidget(self.session_disconnect)
        box.addLayout(controls)
        self.session_error = label("", "message")
        box.addWidget(self.session_error)
        box.addWidget(label("A WebSocket session is not a device VPN. Use wss:// for TLS; ws:// is unencrypted.", "subtitle"))
        layout.addWidget(frame)
        fetch_frame, fetch_box = card()
        fetch_box.addWidget(label("Fetch through this server", "sectionTitle"))
        fetch_box.addWidget(label("Send one public HTTP(S) GET through the connected session. This does not proxy your other apps.", "subtitle"))
        self.fetch_address = QLineEdit()
        self.fetch_address.setAccessibleName("URL to fetch through server")
        self.fetch_address.setPlaceholderText("https://example.org/")
        fetch_box.addWidget(self.fetch_address)
        self.fetch_button = button("Fetch URL")
        self.fetch_button.clicked.connect(self.fetch_url)
        fetch_box.addWidget(self.fetch_button)
        self.fetch_result = QPlainTextEdit()
        self.fetch_result.setAccessibleName("Fetch result")
        self.fetch_result.setReadOnly(True)
        self.fetch_result.setMinimumHeight(120)
        self.fetch_result.setPlaceholderText("Responses are limited to 6,000 bytes.")
        fetch_box.addWidget(self.fetch_result)
        layout.addWidget(fetch_frame)
        layout.addStretch()
        self._add_page(content)

    def _build_profiles(self):
        content, layout = page()
        layout.addWidget(label("WireGuard profile", "sectionTitle"))
        frame, box = card()
        self.profile_label = label("No saved profile", "status")
        box.addWidget(self.profile_label)
        box.addWidget(label("Private keys are stored in the operating system keychain. Import a full-tunnel profile supplied by your VPN operator.", "subtitle"))
        self.profile_import = button("Import or replace profile")
        self.profile_import.clicked.connect(self.import_profile)
        self.profile_remove = button("Remove saved profile")
        self.profile_remove.clicked.connect(self.remove_profile)
        box.addWidget(self.profile_import)
        box.addWidget(self.profile_remove)
        self.profile_message = label("", "message")
        box.addWidget(self.profile_message)
        box.addWidget(label("The endpoint comes from the imported profile. To change servers, import a different profile after disconnecting.", "subtitle"))
        layout.addWidget(frame)
        layout.addStretch()
        self._add_page(content)

    def _build_releases(self):
        content, layout = page()
        layout.addWidget(label("Releases", "sectionTitle"))
        frame, box = card()
        box.addWidget(label("Published GitHub downloads open in your system browser.", "subtitle"))
        self.release_filter = QComboBox()
        self.release_filter.setAccessibleName("Release platform")
        for text, value in (("All platforms", "all"), ("Windows", "windows"), ("macOS", "macos"), ("Linux", "linux"),
                            ("Android", "android"), ("iOS", "ios"), ("Web preview", "web"), ("Server", "server")):
            self.release_filter.addItem(text, value)
        self.release_filter.currentIndexChanged.connect(self._display_releases)
        box.addWidget(self.release_filter)
        self.release_status = label("Load published releases from GitHub.", "subtitle")
        box.addWidget(self.release_status)
        self.release_list = QListWidget()
        self.release_list.setAccessibleName("Release assets")
        self.release_list.setMinimumHeight(200)
        self.release_list.itemDoubleClicked.connect(lambda _: self.open_release_asset())
        box.addWidget(self.release_list)
        self.release_open = button("Open selected download")
        self.release_open.setEnabled(False)
        self.release_list.itemSelectionChanged.connect(lambda: self.release_open.setEnabled(bool(self.release_list.selectedItems())))
        self.release_open.clicked.connect(self.open_release_asset)
        self.release_page = button("Open latest release page")
        self.release_page.setEnabled(False)
        self.release_page.clicked.connect(self.open_release_page)
        self.release_refresh = button("Refresh releases", "primary")
        self.release_refresh.clicked.connect(lambda: self.fetch_releases(True))
        box.addWidget(self.release_open)
        box.addWidget(self.release_page)
        box.addWidget(self.release_refresh)
        layout.addWidget(frame)
        layout.addStretch()
        self._add_page(content)

    def _build_settings(self):
        content, layout = page()
        layout.addWidget(label("Settings & safety", "sectionTitle"))
        server_frame, server_box = card()
        server_box.addWidget(label("WebSocket server & Stealth relay", "sectionTitle"))
        self.server_input = QLineEdit(str(self.settings.value("serverUrl", "")))
        self.server_input.setAccessibleName("WebSocket server address")
        self.server_input.setPlaceholderText("wss://server.example.com/ops")
        self.user_input = QLineEdit(str(self.settings.value("username", "")))
        self.user_input.setAccessibleName("WebSocket username")
        self.user_input.setPlaceholderText("Username")
        self.psk_input = QLineEdit()
        self.psk_input.setAccessibleName("WebSocket PSK")
        self.psk_input.setEchoMode(QLineEdit.EchoMode.Password)
        self.psk_input.setPlaceholderText("PSK (kept in memory only)")
        server_box.addWidget(self.server_input)
        server_box.addWidget(self.user_input)
        server_box.addWidget(self.psk_input)
        save = button("Save server settings")
        save.clicked.connect(self.save_server_settings)
        server_box.addWidget(save)
        self.settings_message = label("Stealth VPN uses this server and PSK at /stealth-wg; wss:// is required. The PSK is never saved by this app.", "subtitle")
        server_box.addWidget(self.settings_message)
        layout.addWidget(server_frame)
        frame, box = card()
        box.addWidget(label("Native WireGuard integration", "sectionTitle"))
        box.addWidget(label("Install WireGuard's system tools and use an unlocked system keychain. Starting and stopping the tunnel requires administrator authorization.", "subtitle"))
        box.addWidget(label("DNS policies use third-party resolvers: AdGuard DNS, Quad9, profile DNS/Cloudflare, or custom IPs. Applications using their own encrypted DNS may bypass filtering.", "subtitle"))
        box.addWidget(label("No general kill switch, peer verification, or LAN leak protection is provided. On Windows, Stealth disables WireGuard's block-untunneled firewall to allow the relay. Check system routes and connectivity independently.", "subtitle"))
        self.settings_status = label("Checking device VPN…", "subtitle")
        box.addWidget(self.settings_status)
        self.refresh_button = button("Refresh device status")
        self.refresh_button.clicked.connect(self.refresh_status)
        box.addWidget(self.refresh_button)
        layout.addWidget(frame)
        layout.addStretch()
        self._add_page(content)

    def select_page(self, index):
        self.stack.setCurrentIndex(index)
        for i, nav in enumerate(self.nav_buttons):
            nav.setChecked(i == index)
        if index == 3 and self.releases is None and not self.releases_busy:
            self.fetch_releases(False)

    def _dns_changed(self):
        value = str(self.dns_mode.currentData())
        self.settings.setValue("dnsMode", value)
        self.custom_dns.setVisible(value == "custom")

    def _submit(self, operation, callback):
        job = Job(operation)
        self.jobs.add(job)

        def finished(result, error):
            self.jobs.discard(job)
            callback(result, error)
        job.signals.finished.connect(finished)
        self.pool.start(job)

    def _reset_targets(self):
        self.session_targets.clear()
        server = self.server_input.text().strip()
        self.session_targets.addItem("Configured server" if server else "Configure a server in Settings", server or None)

    def save_server_settings(self):
        server = self.server_input.text().strip()
        username = self.user_input.text().strip()
        try:
            parse_server(server)
            if not username or len(username) > 128 or any(ord(c) < 32 for c in username):
                raise ValueError("Enter a valid username")
        except ValueError as error:
            self.settings_message.setText(str(error))
            return False
        self.settings.setValue("serverUrl", server)
        self.settings.setValue("username", username)
        self.settings_message.setText("Server and username saved. The PSK remains in memory only.")
        self._reset_targets()
        return True

    def refresh_directory(self):
        if self.directory_busy:
            return
        server = self.server_input.text().strip()
        try:
            parse_server(server)
        except ValueError as error:
            self.directory_message.setText(str(error))
            return
        self.directory_busy = True
        self.directory_message.setText("Loading advertised locations…")
        self.refresh_session()

        def done(result, error):
            self.directory_busy = False
            if error:
                self.directory_message.setText(error)
            else:
                self.session_targets.clear()
                for target in result:
                    region = " / ".join(part for part in (target.get("country", ""), target.get("region", "")) if part)
                    caption = f"{region} — {target['name']}" if region else target["name"]
                    self.session_targets.addItem(caption, target["url"])
                self.directory_message.setText(f"{len(result)} available server(s). Select a location to connect.")
            self.refresh_session()
        self._submit(lambda: self.directory(server), done)

    def refresh_session(self):
        state = self.session.status()
        names = {"connected": "WebSocket session connected", "connecting": "Connecting session…", "disconnected": "Session disconnected"}
        self.session_status.setText(names.get(state.get("state"), "Session status unavailable"))
        self.session_detail.setText(state.get("message", ""))
        disconnected = state.get("state") == "disconnected"
        connected = state.get("state") == "connected"
        self.session_connect.setEnabled(disconnected)
        self.session_disconnect.setEnabled(not disconnected)
        self.session_targets.setEnabled(disconnected and not self.directory_busy)
        self.session_mode.setEnabled(disconnected)
        self.directory_button.setEnabled(disconnected and not self.directory_busy)
        self.fetch_button.setEnabled(connected and not self.fetch_busy)

    def connect_session(self):
        server = self.session_targets.currentData() or self.server_input.text().strip()
        username, psk = self.user_input.text().strip(), self.psk_input.text()
        mode = str(self.session_mode.currentData())
        try:
            parse_server(server)
            if not username or not psk:
                raise ValueError("Enter the server, username and PSK in Settings first")
            generation = self.session.begin()
        except Exception as error:
            self.session_error.setText(clean_error(error))
            return
        self.session_error.setText("")
        self.refresh_session()

        def done(_result, error):
            if error and "cancelled" not in error.lower():
                self.session_error.setText(error)
            self.refresh_session()
        self._submit(lambda: self.session.connect(server, username, psk, mode, generation), done)

    def disconnect_session(self):
        socket = self.session.cancel()
        self.session_error.setText("")
        self.refresh_session()
        if socket is not None:
            self._submit(lambda: self.session.close_socket(socket), lambda _result, _error: self.refresh_session())

    def fetch_url(self):
        if self.fetch_busy:
            return
        address = self.fetch_address.text()
        self.fetch_busy = True
        self.fetch_result.setPlainText("Fetching…")
        self.refresh_session()

        def done(result, error):
            self.fetch_busy = False
            if error:
                self.fetch_result.setPlainText(error)
            else:
                suffix = "\n\n[Response truncated]" if result["truncated"] else ""
                self.fetch_result.setPlainText(f"HTTP {result['status']}\n\n{result['body']}{suffix}")
            self.refresh_session()
        self._submit(lambda: self.session.fetch(address), done)

    def closeEvent(self, event):
        if self.device_busy:
            self._set_device_message("Wait for the device VPN operation to finish before closing OpenPath.")
            event.ignore()
            return
        if getattr(self.vpn, "relay_running", lambda: False)():
            QMessageBox.warning(self, "Stealth VPN is active", "Disconnect the Stealth device VPN before closing OpenPath. Its TLS relay runs in this app.")
            event.ignore()
            return
        self.session.disconnect()
        super().closeEvent(event)

    def _sync_controls(self):
        status = self.current_status or {}
        inactive = status.get("state") in ("inactive", "unverified")
        active_or_stopped = status.get("state") in ("active", "stopped")
        self.import_button.setEnabled(not self.device_busy and inactive)
        self.profile_import.setEnabled(not self.device_busy and inactive)
        self.profile_remove.setEnabled(not self.device_busy and inactive and bool(status.get("configured")))
        self.connect_button.setEnabled(not self.device_busy and inactive and bool(status.get("configured")) and bool(status.get("installed")))
        self.disconnect_button.setEnabled(not self.device_busy and active_or_stopped and bool(status.get("owned")))
        self.vpn_transport.setEnabled(not self.device_busy and inactive)
        self.dns_mode.setEnabled(not self.device_busy and inactive)
        self.custom_dns.setEnabled(not self.device_busy and inactive)
        self.refresh_button.setEnabled(not self.device_busy and not self.status_busy)

    def refresh_status(self):
        if self.device_busy or self.status_busy:
            return
        self.status_busy = True
        revision = self.device_revision
        self._sync_controls()

        def done(result, error):
            self.status_busy = False
            if revision != self.device_revision:
                self._sync_controls()
                if not self.device_busy:
                    self.refresh_status()
                return
            if not self.device_busy:
                if error:
                    self.current_status = None
                    self.status_label.setText("Device VPN status unavailable")
                    self.status_detail.setText(error)
                    self.settings_status.setText(f"Device VPN status unavailable: {error}")
                else:
                    self._show_status(result)
            self._sync_controls()
        self._submit(self.vpn.status, done)

    def _show_status(self, state):
        self.current_status = state
        names = {"active": "WireGuard interface active", "inactive": "Device VPN disconnected",
                 "stopped": "WireGuard service stopped", "unsupported": "Device VPN unsupported on this system",
                 "unknown": "Device VPN status unavailable", "unverified": "Device VPN status unverified"}
        status_text = names.get(state.get("state"), "Device VPN status unavailable")
        self.status_label.setText(status_text)
        self.settings_status.setText(status_text)
        detail = state.get("message") or "An active interface does not confirm a successful peer handshake."
        if not state.get("installed"):
            detail += " Install WireGuard and its system tools before connecting."
        self.status_detail.setText(detail)
        endpoint = state.get("endpoint")
        self.endpoint_label.setText(f"Peer: {endpoint}" if endpoint else "No WireGuard profile imported")
        self.profile_label.setText(f"Peer: {endpoint}" if endpoint else "No saved profile")
        self._sync_controls()

    def _set_device_message(self, message):
        self.device_message.setText(message)
        self.profile_message.setText(message)

    def _device_action(self, operation, success):
        if self.device_busy:
            return
        self.device_busy = True
        self.device_revision += 1
        self._set_device_message("")
        self._sync_controls()

        def done(result, error):
            self.device_busy = False
            if error:
                self._set_device_message(error)
            elif not (isinstance(result, dict) and result.get("canceled")):
                message = success
                if isinstance(result, dict) and result.get("endpoint"):
                    message = f"Profile imported for {result['endpoint']}."
                    if not result.get("hasIPv6Address"):
                        message += " This profile has no IPv6 interface address; IPv6 traffic may not work."
                self._set_device_message(message)
            self._sync_controls()
            self.refresh_status()
        self._submit(operation, done)

    def import_profile(self):
        filename, _ = QFileDialog.getOpenFileName(self, "Import WireGuard profile", "", "WireGuard configuration (*.conf);;All files (*)")
        if filename:
            self._device_action(lambda: self.vpn.import_file(filename), "Profile imported")

    def remove_profile(self):
        self._device_action(self.vpn.remove_profile, "Saved profile removed")

    def connect_vpn(self):
        options = {"dnsMode": str(self.dns_mode.currentData()), "customDns": self.custom_dns.text()}
        if self.vpn_transport.currentData() == "stealth":
            if sys.platform == "win32":
                choice = QMessageBox.warning(self, "Windows Stealth safety warning",
                    "Stealth uses split default routes so its TLS relay can connect. This disables WireGuard for Windows' block-untunneled firewall, including its DNS restriction. Traffic may leak. Continue?",
                    QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No, QMessageBox.StandardButton.No)
                if choice != QMessageBox.StandardButton.Yes:
                    return
                options["allowWindowsStealthWithoutKillSwitch"] = "yes"
            options.update({"transport": "stealth", "relayServer": self.server_input.text().strip(),
                            "relayUsername": self.user_input.text().strip(), "relayPsk": self.psk_input.text()})
        self._device_action(lambda: self.vpn.connect(options), "WireGuard interface started; verify peer connectivity.")

    def disconnect_vpn(self):
        self._device_action(self.vpn.disconnect, "Device VPN disconnected")

    def fetch_releases(self, force=False):
        if self.releases_busy:
            return
        self.releases_busy = True
        self.release_status.setText("Loading releases…")
        self.release_refresh.setEnabled(False)

        def done(result, error):
            self.releases_busy = False
            self.release_refresh.setEnabled(True)
            if error:
                self.release_warning = f"Could not load releases: {error}"
            else:
                self.releases = result["releases"]
                self.release_warning = f"Showing cached releases: {result.get('warning', '')}" if result.get("stale") else ""
            self._display_releases()
        self._submit(lambda: self.feed.load(force), done)

    def _display_releases(self):
        self.release_list.clear()
        self.release_open.setEnabled(False)
        latest_url = self.releases[0].get("url") if self.releases else None
        self.release_page.setEnabled(trusted_link(latest_url))
        if self.release_warning:
            self.release_status.setText(self.release_warning)
        elif self.releases is None:
            self.release_status.setText("Load published releases from GitHub.")
        elif not self.releases:
            self.release_status.setText("No releases have been published yet.")
        else:
            self.release_status.setText("Published releases from GitHub.")
        count = 0
        for release in self.releases or []:
            for asset in release.get("assets", []):
                if not matches(str(self.release_filter.currentData()), asset.get("name", "")):
                    continue
                item = QListWidgetItem(f"{release['tag']}  ·  {asset['name']}")
                item.setData(Qt.ItemDataRole.UserRole, asset["url"])
                self.release_list.addItem(item)
                count += 1
        if self.releases and not count and not self.release_warning:
            self.release_status.setText("No assets for this platform in the published releases yet.")

    def open_release_page(self):
        url = self.releases[0].get("url") if self.releases else None
        if not trusted_link(url) or not self.launch_url(url):
            self.release_status.setText("Could not open this release in the system browser.")

    def open_release_asset(self):
        selected = self.release_list.selectedItems()
        if not selected:
            return
        url = selected[0].data(Qt.ItemDataRole.UserRole)
        if not trusted_link(url) or not self.launch_url(url):
            self.release_status.setText("Could not open this download in the system browser.")


def main() -> int:
    app = QApplication(sys.argv)
    app.setApplicationName("OpenPath")
    app.setOrganizationName("OpenPath")
    bundle_root = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[3]))
    icon = bundle_root / "assets" / "icon-512.png"
    if icon.is_file():
        app.setWindowIcon(QIcon(str(icon)))
    smoke_test = "--smoke-test" in sys.argv
    window = MainWindow(auto_refresh=not smoke_test)
    window.show()
    if smoke_test:
        # Exercise bundled network and keychain imports without reading or writing secrets.
        from websockets.sync.client import connect as _websocket_connect  # noqa: F401
        if sys.platform == "win32":
            from keyring.backends import Windows as _backend  # noqa: F401
        elif sys.platform == "darwin":
            from keyring.backends import macOS as _backend  # noqa: F401
        else:
            from keyring.backends import SecretService as _backend  # noqa: F401
        QTimer.singleShot(750, app.quit)
    return app.exec()
