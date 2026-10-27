package com.openpath.vpn

import android.net.VpnService
import android.content.Intent
import android.os.ParcelFileDescriptor
import java.io.FileInputStream
import java.io.FileOutputStream
import java.nio.ByteBuffer
import kotlinx.coroutines.*

/**
 * Android VpnService — captures all device traffic via TUN and forwards through
 * OpenPath stealth protocol (openpath-core via Gomobile AAR).
 *
 * Setup:
 *  1. Build Gomobile AAR: `gomobile bind -target=android ./client/core/go`
 *  2. Import as module in Android Studio.
 *  3. This service establishes Builder().addAddress("10.89.0.2",24).addRoute("0.0.0.0",0)
 *
 * Stealth: uses same wss:// + HMAC auth as other platforms — looks like Chrome.
 */
class OpenVpnService : VpnService() {

    private var tunFd: ParcelFileDescriptor? = null
    private var job: Job? = null
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    // Config injected from MainActivity via Intent extras
    private lateinit var serverUrl: String
    private lateinit var psk: String
    private var stealthPadding = true
    private var jitterMs = 20

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        serverUrl = intent?.getStringExtra("serverUrl") ?: "wss://cdn.openpath.example.com/ops"
        psk = intent?.getStringExtra("psk") ?: ""
        stealthPadding = intent?.getBooleanExtra("stealthPadding", true) ?: true
        startTunnel()
        return START_STICKY
    }

    private fun startTunnel() {
        val builder = Builder()
            .addAddress("10.89.0.2", 24)
            .addRoute("0.0.0.0", 0) // capture all (or split: add allowed apps via builder.addAllowedApplication)
            .addDnsServer("1.1.1.1")
            .setSession("OpenPath")
            .setMtu(1420)
            .setConfigureIntent(null)

        try { builder.establish()?.let { fd ->
            tunFd = fd
            job = scope.launch {
                // In real build, bridging TUN ↔ openpath-core transport:
                //  val core = OpenPathCore(serverUrl, psk, padding=stealthPadding, jitter=jitterMs)
                //  core.connect()
                //  launch { forwardTunToCore(fd, core) }
                //  launch { forwardCoreToTun(fd, core) }
                // For demo we simulate TUN read/write echo:
                val input = FileInputStream(fd.fileDescriptor)
                val output = FileOutputStream(fd.fileDescriptor)
                val buf = ByteArray(2048)
                while (isActive) {
                    // Normally: read IP packet from TUN, frame as OPSP, send via WSS
                    delay(100)
                    // keepalive — real impl sends via core.send()
                }
            }
        }} catch(e: Exception){ stopSelf() }
    }

    // Forward helpers (pseudocode for real implementation):
    private suspend fun forwardTunToCore(fd: ParcelFileDescriptor, core: Any) {
        val input = FileInputStream(fd.fileDescriptor)
        val buf = ByteBuffer.allocate(2048)
        while (true) {
            val n = input.read(buf.array()) // blocking; wrap in withContext(Dispatchers.IO)
            // core.send(TUN_IPv4 frame)
        }
    }
    private suspend fun forwardCoreToTun(fd: ParcelFileDescriptor, core: Any) {
        val output = FileOutputStream(fd.fileDescriptor)
        // core.onPacket { pkt -> output.write(pkt) }
    }

    override fun onDestroy() {
        job?.cancel()
        tunFd?.close()
        super.onDestroy()
    }
}
