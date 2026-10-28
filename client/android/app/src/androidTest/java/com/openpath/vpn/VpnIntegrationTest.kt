package com.openpath.vpn

import android.content.Context
import android.content.Intent
import android.net.VpnService
import android.util.Base64
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.net.InetSocketAddress
import java.net.Socket

/** Runs only on the CI emulator with a freshly generated, local test peer. */
@RunWith(AndroidJUnit4::class)
class VpnIntegrationTest {
    private fun waitForOperation(manager: TunnelManager) {
        val deadline = System.currentTimeMillis() + 45000
        while (manager.working && System.currentTimeMillis() < deadline) Thread.sleep(100)
        assertFalse("Operation timed out: ${manager.message}", manager.working)
    }

    @Test fun keystorePermissionAndRealWireGuardTraffic() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val argument = InstrumentationRegistry.getArguments().getString("profile")
            ?: error("The emulator test requires a synthetic profile")
        val profile = Base64.decode(argument, Base64.DEFAULT)
        ProfileValidator.parse(profile)
        val store = SecureProfileStore(context)
        store.save(profile)
        assertArrayEquals(profile, store.load()) // actual emulator Android Keystore
        val encoded = context.getSharedPreferences("wireguard_profile", Context.MODE_PRIVATE).getString("ciphertext", "")!!
        assertFalse(Base64.decode(encoded, Base64.DEFAULT).contentEquals(profile))
        profile.fill(0)

        // Keep an activity in the foreground while the backend starts VpnService.
        val activity = instrumentation.startActivitySync(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        val manager = (context.applicationContext as OpenPathApplication).tunnelManager
        try {
            assertNull("Emulator VPN consent was not granted", VpnService.prepare(context))
            assertTrue(manager.configured)
            assertTrue(manager.connect("profile", ""))
            waitForOperation(manager)
            assertTrue("WireGuard did not start: ${manager.message}", manager.active)

            // This address is reachable only through the CI's local WireGuard peer.
            Socket().use { socket ->
                socket.connect(InetSocketAddress("10.203.0.1", 19430), 10000)
                socket.soTimeout = 10000
                socket.getOutputStream().write("openpath".toByteArray())
                val reply = ByteArray(2)
                java.io.DataInputStream(socket.getInputStream()).readFully(reply)
                assertEquals("ok", String(reply))
            }
        } finally {
            if (manager.active && manager.disconnect()) waitForOperation(manager)
            store.remove()
            instrumentation.runOnMainSync { activity.finish() }
        }
        assertFalse("VPN did not disconnect", manager.active)
    }
}
