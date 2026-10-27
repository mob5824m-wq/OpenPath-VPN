package com.openpath.vpn

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/**
 * Android persistent VPN notification — always-present like Proton VPN screenshot.
 * ForegroundService with ongoing:true, priority MAX, actions: Disconnect, Open.
 * Shows: Connected to Canada, ↓ 100.94 MB | 2.16 KB/s, ↑ 22.14 MB | 2.74 KB/s
 * Updated every 1s via VpnService stats.
 *
 * Usage: called from OpenVpnService.kt on connect:
 *   val nm = NotificationHelper(this)
 *   nm.showConnected("Canada", "CA", 100.94*MB, 2.16*KB/s, 22.14*MB, 2.74*KB/s)
 *   startForeground(NOTIF_ID, notification)
 */
class NotificationHelper(private val ctx: Context) {
    companion object {
        const val NOTIF_ID = 1001
        const val CHANNEL_ID = "openpath-vpn-status"
        const val CHANNEL_NAME = "OpenPath VPN Status"
    }

    init { createChannel() }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_LOW).apply {
                description = "Always shows when VPN is connected"
                setShowBadge(false)
                enableVibration(false)
                setSound(null, null)
            }
            (ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(ch)
        }
    }

    fun showConnecting() = showInternal(
        title = "OpenPath VPN",
        content = "Connecting...",
        ongoing = true,
        actions = emptyList()
    )

    fun showConnected(
        country: String, flag: String = "🇨🇦",
        rxBytes: Long, rxSpeedBps: Long,
        txBytes: Long, txSpeedBps: Long,
        ip: String = "185.159.157.12"
    ): Notification {
        val rx = formatBytes(rxBytes); val rxS = formatSpeed(rxSpeedBps)
        val tx = formatBytes(txBytes); val txS = formatSpeed(txSpeedBps)
        // InboxStyle mimics 3-line like Proton screenshot
        val style = NotificationCompat.InboxStyle()
            .addLine(" ↓ $rx | $rxS")
            .addLine(" ↑ $tx | $txS")
            .addLine(ip)

        return NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_shield) // generate from assets/logo.png → adaptive icon
            .setContentTitle("$flag Connected to $country")
            .setContentText("↓ $rx | $rxS  ↑ $tx | $txS")
            .setStyle(style)
            .setOngoing(true) // cannot swipe away while connected (like Proton)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setShowWhen(false)
            .setOnlyAlertOnce(true)
            .addAction(NotificationCompat.Action.Builder(
                R.drawable.ic_close, "Disconnect",
                PendingIntent.getService(ctx, 1, Intent(ctx, OpenVpnService::class.java).apply { action = "DISCONNECT" }, PendingIntent.FLAG_IMMUTABLE)
            ).build())
            .addAction(NotificationCompat.Action.Builder(
                R.drawable.ic_open, "Open",
                PendingIntent.getActivity(ctx, 2, Intent(ctx, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
            ).build())
            .build()
    }

    fun showDisconnected() = showInternal(
        title = "OpenPath VPN",
        content = "Not connected",
        ongoing = false,
        actions = listOf("Connect" to Intent(ctx, MainActivity::class.java))
    )

    private fun showInternal(title: String, content: String, ongoing: Boolean, actions: List<Pair<String, Intent>>) {
        val b = NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_shield)
            .setContentTitle(title)
            .setContentText(content)
            .setOngoing(ongoing)
            .setPriority(NotificationCompat.PRIORITY_LOW)
        actions.forEach { (label, intent) ->
            b.addAction(0, label, PendingIntent.getActivity(ctx, 0, intent, PendingIntent.FLAG_IMMUTABLE))
        }
        NotificationManagerCompat.from(ctx).notify(NOTIF_ID, b.build())
    }

    fun cancel() = NotificationManagerCompat.from(ctx).cancel(NOTIF_ID)

    private fun formatBytes(b: Long): String = when {
        b < 1024 -> "$b B"
        b < 1024*1024 -> String.format("%.2f KB", b/1024.0)
        b < 1024*1024*1024 -> String.format("%.2f MB", b/1024.0/1024.0)
        else -> String.format("%.2f GB", b/1024.0/1024.0/1024.0)
    }
    private fun formatSpeed(bps: Long): String = formatBytes(bps) + "/s"
}
