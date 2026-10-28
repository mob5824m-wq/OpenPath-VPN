package com.openpath.vpn

import android.app.Application
import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import com.wireguard.android.backend.GoBackend
import com.wireguard.android.backend.Tunnel
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.util.concurrent.Executors

class OpenPathApplication : Application() {
    val tunnelManager: TunnelManager by lazy { TunnelManager(this) }
}

/** Serializes all mutations; status comes from the WireGuard backend, not a UI toggle. */
class TunnelManager(private val context: Context) {
    private val store = SecureProfileStore(context)
    private val executor = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private val lock = Any()
    @Volatile private var listener: (() -> Unit)? = null
    @Volatile var active = false
        private set
    @Volatile var working = false
        private set
    @Volatile var configured = store.exists()
        private set
    @Volatile var message = if (configured) "An encrypted profile is saved. Connect to start WireGuard."
        else "Import a WireGuard profile from your VPN operator."
        private set

    private val tunnel = object : Tunnel {
        override fun getName() = "openpath"
        override fun onStateChange(newState: Tunnel.State) {
            active = newState == Tunnel.State.UP
            message = if (active) "Interface active. Peer handshake and internet reachability are not verified."
                else "Device VPN disconnected."
            publish()
        }
    }
    private val backend by lazy { GoBackend(context.applicationContext) }

    fun observe(callback: (() -> Unit)?) { listener = callback }
    private fun publish() { main.post { listener?.invoke() } }

    private class UserError(message: String) : Exception(message)
    private fun <T> validated(block: () -> T): T = try { block() }
        catch (error: IllegalArgumentException) { throw UserError(error.message ?: "Invalid profile.") }

    private fun run(failure: String, operation: () -> Unit): Boolean {
        synchronized(lock) {
            if (working) return false
            working = true
        }
        publish()
        executor.execute {
            try { operation() }
            catch (error: UserError) { message = error.message ?: failure }
            catch (_: Exception) { message = failure }
            catch (_: LinkageError) { message = "WireGuard backend is unavailable on this device." }
            finally { working = false; publish() }
        }
        return true
    }

    fun importProfile(uri: Uri): Boolean = run("Could not import or encrypt the profile. Verify file access and the device keystore.") {
        if (active) throw UserError("Disconnect before replacing the profile.")
        val bytes = context.contentResolver.openInputStream(uri)?.use { readBounded(it) }
            ?: throw UserError("Could not open the selected file.")
        try {
            validated { ProfileValidator.parse(bytes) }
            store.save(bytes)
            configured = true
            message = "Profile encrypted on this device. Connect to request Android VPN permission."
        } finally { bytes.fill(0) }
    }

    fun removeProfile(): Boolean = run("Could not remove the encrypted profile.") {
        if (active) throw UserError("Disconnect before removing the profile.")
        store.remove()
        configured = false
        message = "Profile removed from this app. Your original file was not deleted."
    }

    fun connect(mode: String, custom: String): Boolean = run("Could not start WireGuard. Check permission, the profile, network and server.") {
        if (active) throw UserError("The WireGuard interface is already active.")
        val bytes = store.load()
        try {
            val config = validated { ProfileValidator.withDns(ProfileValidator.parse(bytes), mode, custom) }
            if (backend.setState(tunnel, Tunnel.State.UP, config) != Tunnel.State.UP) {
                throw UserError("WireGuard did not start. Check the profile and Android VPN permission.")
            }
            // The backend's state callback owns the displayed state. A service
            // revocation can race with setState returning, so do not force it UP here.
        } finally { bytes.fill(0) }
    }

    fun disconnect(): Boolean = run("Could not disconnect WireGuard. Check Android VPN settings.") {
        if (backend.setState(tunnel, Tunnel.State.DOWN, null) != Tunnel.State.DOWN) {
            throw UserError("WireGuard did not disconnect. Check Android VPN settings.")
        }
        active = false
        message = "Device VPN disconnected."
    }

    companion object {
        internal fun readBounded(input: InputStream): ByteArray {
            val out = ByteArrayOutputStream()
            val buffer = ByteArray(4096)
            while (true) {
                val count = input.read(buffer)
                if (count == -1) break
                if (out.size() + count > ProfileValidator.MAX_BYTES) {
                    throw UserError("Profile exceeds 64 KiB.")
                }
                out.write(buffer, 0, count)
            }
            return out.toByteArray()
        }
    }
}
