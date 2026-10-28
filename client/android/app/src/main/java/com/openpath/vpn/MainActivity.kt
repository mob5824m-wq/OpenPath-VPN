package com.openpath.vpn

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.net.VpnService
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.TextView

/** Native Android Views; no WebView, local web server or simulated packet loop. */
class MainActivity : Activity() {
    private val manager get() = (application as OpenPathApplication).tunnelManager
    private val preferences by lazy { getSharedPreferences("settings", MODE_PRIVATE) }
    private var page = 0
    private var mode = "profile"
    private var customDns = ""
    private val modes = arrayOf("profile", "malware", "ads", "custom")
    private val modeLabels = arrayOf("Profile DNS (Cloudflare fallback)", "Quad9 — malware filtering", "AdGuard DNS — ads, trackers and malware", "Custom DNS IPs")
    private val background = Color.rgb(9, 9, 15)
    private val panel = Color.rgb(21, 20, 30)
    private val border = Color.rgb(48, 46, 61)
    private val muted = Color.rgb(181, 179, 196)
    private val purple = Color.rgb(109, 74, 255)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        page = savedInstanceState?.getInt("page", 0) ?: 0
        mode = preferences.getString("dns_mode", "profile") ?: "profile"
        if (mode !in modes) mode = "profile"
        customDns = preferences.getString("custom_dns", "") ?: ""
        render()
    }

    override fun onStart() {
        super.onStart()
        manager.observe { if (!isFinishing && !isDestroyed) render() }
        render()
    }

    override fun onStop() {
        manager.observe(null)
        super.onStop()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putInt("page", page)
        super.onSaveInstanceState(outState)
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density + 0.5f).toInt()
    private fun shape(color: Int, corner: Int = 12, stroke: Int? = border): GradientDrawable = GradientDrawable().apply {
        setColor(color)
        cornerRadius = dp(corner).toFloat()
        if (stroke != null) setStroke(dp(1), stroke)
    }
    private fun vertical() = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
    private fun text(value: String, size: Float = 14f, color: Int = Color.WHITE, bold: Boolean = false): TextView =
        TextView(this).apply {
            text = value
            textSize = size
            setTextColor(color)
            if (bold) setTypeface(typeface, Typeface.BOLD)
            setLineSpacing(dp(3).toFloat(), 1f)
        }
    private fun spacing(height: Int): View = View(this).apply {
        layoutParams = LinearLayout.LayoutParams(1, dp(height))
    }
    private fun action(label: String, enabled: Boolean = true, primary: Boolean = false, onClick: () -> Unit): Button =
        Button(this).apply {
            text = label
            isAllCaps = false
            textSize = 14f
            setTextColor(Color.WHITE)
            setTypeface(typeface, Typeface.BOLD)
            background = shape(if (primary) purple else Color.rgb(38, 36, 53), 9)
            setPadding(dp(12), dp(10), dp(12), dp(10))
            minimumHeight = dp(48)
            isEnabled = enabled
            alpha = if (enabled) 1f else .45f
            setOnClickListener { onClick() }
        }
    private fun LinearLayout.addAction(label: String, enabled: Boolean = true, primary: Boolean = false, onClick: () -> Unit) {
        addView(spacing(10))
        addView(action(label, enabled, primary, onClick), LinearLayout.LayoutParams(-1, -2))
    }
    private fun card(title: String, content: LinearLayout.() -> Unit): View {
        val box = vertical().apply {
            background = shape(panel)
            setPadding(dp(16), dp(16), dp(16), dp(16))
            addView(text(title, 16f, bold = true))
            addView(spacing(8))
            content()
        }
        return box
    }
    private fun LinearLayout.addCard(title: String, content: LinearLayout.() -> Unit) {
        addView(spacing(12))
        addView(card(title, content), LinearLayout.LayoutParams(-1, -2))
    }

    private fun render() {
        val wide = resources.configuration.screenWidthDp >= 720
        val root = vertical().apply { setBackgroundColor(background) }
        // Android 15 enforces edge-to-edge for target 35. Keep controls clear of system bars.
        @Suppress("DEPRECATION")
        root.setOnApplyWindowInsetsListener { view, insets ->
            view.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop,
                insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
            insets
        }
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(18), dp(14), dp(18), dp(14))
            setBackgroundColor(panel)
            addView(text("◈  OpenPath", 21f, bold = true), LinearLayout.LayoutParams(0, -2, 1f))
            addView(text("WIREGUARD", 10f, muted, true))
        }
        root.addView(header)
        val body = LinearLayout(this).apply { orientation = if (wide) LinearLayout.HORIZONTAL else LinearLayout.VERTICAL }
        root.addView(body, LinearLayout.LayoutParams(-1, 0, 1f))
        val navigation = navigation(wide)
        if (wide) body.addView(navigation, LinearLayout.LayoutParams(dp(190), -1))
        val scroll = ScrollView(this).apply { isFillViewport = true }
        val centered = FrameLayout(this)
        val content = vertical().apply { setPadding(dp(16), dp(16), dp(16), dp(24)) }
        val availableDp = resources.configuration.screenWidthDp - if (wide) 190 else 0
        val contentWidth = if (availableDp > 920) dp(920) else ViewGroup.LayoutParams.MATCH_PARENT
        centered.addView(content, FrameLayout.LayoutParams(contentWidth, -2, Gravity.TOP or Gravity.CENTER_HORIZONTAL))
        scroll.addView(centered, FrameLayout.LayoutParams(-1, -2))
        body.addView(scroll, LinearLayout.LayoutParams(if (wide) 0 else -1, if (wide) -1 else 0, 1f))
        if (!wide) body.addView(navigation, LinearLayout.LayoutParams(-1, -2))
        when (page) {
            0 -> home(content)
            1 -> profiles(content)
            2 -> settings(content)
            else -> releases(content)
        }
        setContentView(root)
        root.requestApplyInsets()
    }

    private fun navigation(wide: Boolean): LinearLayout {
        val bar = LinearLayout(this).apply {
            orientation = if (wide) LinearLayout.VERTICAL else LinearLayout.HORIZONTAL
            setPadding(dp(8), dp(8), dp(8), dp(8))
            setBackgroundColor(Color.rgb(18, 16, 29))
        }
        val labels = arrayOf("Home", "Profiles", "Settings", "Releases")
        val icons = arrayOf("⌂", "▭", "⚙", "⬆")
        labels.forEachIndexed { index, label ->
            val current = page == index
            val nav = action(if (wide) "${icons[index]}   $label" else label, primary = current) {
                page = index
                render()
            }.apply {
                textSize = if (wide) 14f else 11f
                contentDescription = "$label${if (current) ", current page" else ""}"
                minimumHeight = dp(48)
                setPadding(dp(4), dp(5), dp(4), dp(5))
                if (!current) background = shape(Color.TRANSPARENT, 9, null)
            }
            if (wide) {
                bar.addView(nav, LinearLayout.LayoutParams(-1, -2))
                bar.addView(spacing(4))
            } else bar.addView(nav, LinearLayout.LayoutParams(0, -2, 1f))
        }
        return bar
    }

    private fun home(content: LinearLayout) = with(content) {
        addView(text("Device-wide VPN", 19f, bold = true))
        addCard("Connection") {
            val color = if (manager.active) Color.rgb(94, 239, 193) else Color.rgb(248, 113, 113)
            addView(text(if (manager.working) "Working…" else if (manager.active) "WireGuard interface active" else "Device VPN disconnected", 17f, color, true))
            addView(spacing(8))
            addView(text(manager.message, 13f, muted))
            addView(spacing(8))
            addView(text("An active interface does not prove a peer handshake or internet access.", 12f, muted))
            if (manager.active) addAction("Disconnect", !manager.working) { manager.disconnect() }
            else addAction("Connect WireGuard", manager.configured && !manager.working, true) { requestVpn() }
            if (!manager.configured) addAction("Import a profile", !manager.working) { chooseProfile() }
        }
        addCard("DNS and filtering") {
            addView(text("Selected: ${modeLabels[modes.indexOf(mode)]}. DNS applies only while the VPN is active. Encrypted DNS used by apps may bypass filtering.", 13f, muted))
            addAction("Change DNS settings", !manager.working) { page = 2; render() }
        }
        addCard("About this connection") {
            addView(text("This app uses WireGuard over UDP with an operator-provided server. The separate OpenPath WebSocket session is not implemented in this Android app.", 13f, muted))
        }
    }

    private fun profiles(content: LinearLayout) = with(content) {
        addView(text("WireGuard profile", 19f, bold = true))
        addCard(if (manager.configured) "Profile stored" else "No profile yet") {
            addView(text(if (manager.configured) "The profile is encrypted with Android Keystore. Its original file remains wherever you imported it from." else "Import a .conf file supplied by your VPN operator. It must have one peer and IPv4 and IPv6 default routes.", 13f, muted))
            val editable = !manager.active && !manager.working
            addAction(if (manager.configured) "Replace profile" else "Choose .conf file", editable, true) { chooseProfile() }
            if (manager.configured) addAction("Remove saved profile", editable) {
                AlertDialog.Builder(this@MainActivity).setTitle("Remove saved profile?")
                    .setMessage("This removes the encrypted copy from OpenPath, not the original file.")
                    .setNegativeButton("Cancel", null)
                    .setPositiveButton("Remove") { _, _ -> manager.removeProfile() }.show()
            }
            if (!editable) { addView(spacing(8)); addView(text("Disconnect before changing the profile.", 12f, muted)) }
        }
        addCard("Profile safety") {
            addView(text("Private keys are not displayed or logged. Unsupported wg-quick commands and per-app exclusions are rejected. Keep the original file private, and delete it separately if it is no longer needed.", 13f, muted))
        }
    }

    private fun settings(content: LinearLayout) = with(content) {
        addView(text("Settings", 19f, bold = true))
        addCard("DNS while connected") {
            addView(text("Pick DNS for the next connection. Filtering is provided by the selected resolver, not by OpenPath itself.", 13f, muted))
            addView(spacing(10))
            val custom = EditText(this@MainActivity).apply {
                hint = "1.1.1.1, 9.9.9.9"
                setSingleLine(true)
                setTextColor(Color.WHITE)
                setHintTextColor(muted)
                setText(customDns)
                contentDescription = "Custom DNS IP addresses"
                isEnabled = !manager.active && !manager.working
                addTextChangedListener(object : TextWatcher {
                    override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
                    override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                        customDns = s?.toString() ?: ""
                        preferences.edit().putString("custom_dns", customDns).apply()
                    }
                    override fun afterTextChanged(s: Editable?) = Unit
                })
            }
            val spinner = Spinner(this@MainActivity).apply {
                adapter = ArrayAdapter(this@MainActivity, android.R.layout.simple_spinner_dropdown_item, modeLabels)
                setSelection(modes.indexOf(mode).coerceAtLeast(0))
                contentDescription = "DNS resolver"
                isEnabled = !manager.active && !manager.working
                onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
                    override fun onNothingSelected(parent: AdapterView<*>?) = Unit
                    override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                        mode = modes[position]
                        preferences.edit().putString("dns_mode", mode).apply()
                        custom.visibility = if (mode == "custom") View.VISIBLE else View.GONE
                    }
                }
            }
            addView(spinner, LinearLayout.LayoutParams(-1, dp(48)))
            custom.visibility = if (mode == "custom") View.VISIBLE else View.GONE
            addView(custom, LinearLayout.LayoutParams(-1, -2))
            if (manager.active) { addView(spacing(8)); addView(text("Disconnect to change DNS.", 12f, muted)) }
        }
        addCard("Privacy and limitations") {
            addView(text("No general kill switch, automatic reconnect, live handshake verification or app-specific filtering is provided. Android may replace or stop this VPN; confirm its status in system settings. Private DNS and DNS-over-HTTPS may bypass resolver filtering.", 13f, muted))
        }
    }

    private fun releases(content: LinearLayout) = with(content) {
        addView(text("Releases", 19f, bold = true))
        addCard("OpenPath builds") {
            addView(text("Open the official GitHub releases page in your browser to find published builds and checksums. Test-signed Android APKs are for evaluation only.", 13f, muted))
            addAction("Open GitHub releases", true, true) {
                try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://github.com/mob5824m-wq/OpenPath-VPN/releases"))) }
                catch (_: Exception) { AlertDialog.Builder(this@MainActivity).setMessage("No browser is available.").setPositiveButton("OK", null).show() }
            }
        }
    }

    @Suppress("DEPRECATION")
    private fun chooseProfile() {
        try {
            startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "*/*"
            }, REQUEST_PROFILE)
        } catch (_: Exception) {
            AlertDialog.Builder(this).setMessage("No file picker is available on this device.").setPositiveButton("OK", null).show()
        }
    }

    @Suppress("DEPRECATION")
    private fun requestVpn() {
        try {
            val request = VpnService.prepare(this)
            if (request == null) manager.connect(mode, customDns)
            else startActivityForResult(request, REQUEST_VPN)
        } catch (_: Exception) {
            AlertDialog.Builder(this).setMessage("Android could not request VPN permission.").setPositiveButton("OK", null).show()
        }
    }

    @Deprecated("Android framework result API is used to avoid a WebView or extra UI framework.")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQUEST_PROFILE && resultCode == RESULT_OK) data?.data?.let { manager.importProfile(it) }
        if (requestCode == REQUEST_VPN) {
            if (resultCode == RESULT_OK) manager.connect(mode, customDns)
            else AlertDialog.Builder(this).setMessage("VPN permission was not granted. No connection was started.").setPositiveButton("OK", null).show()
        }
    }

    companion object {
        private const val REQUEST_PROFILE = 10
        private const val REQUEST_VPN = 11
    }
}
