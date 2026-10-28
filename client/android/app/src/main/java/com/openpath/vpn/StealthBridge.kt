package com.openpath.vpn

import android.content.Context
import android.content.Intent
import android.net.VpnService
import android.os.Build
import com.wireguard.android.backend.GoBackend
import okhttp3.ConnectionSpec
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.TlsVersion
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import okio.ByteString.Companion.toByteString
import org.json.JSONObject
import java.io.IOException
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.net.URI
import java.security.SecureRandom
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import javax.net.SocketFactory

/** Access the service owned by the pinned WireGuard GoBackend version.
 * The embedding library has no public service accessor. We intentionally fail
 * closed if its private future changes, rather than excluding the entire app
 * from the VPN or sending an unprotected relay socket into the tunnel.
 */
internal object WireGuardServiceAccess {
    fun start(context: Context): GoBackend.VpnService {
        context.startService(Intent(context, GoBackend.VpnService::class.java))
        val field = GoBackend::class.java.getDeclaredField("vpnService").apply { isAccessible = true }
        val future = field.get(null) as? CompletableFuture<*>
            ?: throw IOException("WireGuard VPN service is unavailable")
        val service = future.get(5, TimeUnit.SECONDS) as? GoBackend.VpnService
            ?: throw IOException("WireGuard VPN service is unavailable")
        if (Build.VERSION.SDK_INT >= 29 && service.isLockdownEnabled) {
            service.stopSelf()
            throw IOException("Stealth VPN does not support Android lockdown mode")
        }
        return service
    }
}

/** Every outgoing relay socket is protected individually before it connects. */
internal class ProtectedSocketFactory(private val service: VpnService) : SocketFactory() {
    private fun newProtectedSocket(local: InetSocketAddress? = null): Socket {
        val socket = Socket()
        try {
            socket.bind(local ?: InetSocketAddress(0))
            if (!service.protect(socket)) throw IOException("Could not protect relay socket")
            return socket
        } catch (error: Exception) {
            socket.close()
            throw error
        }
    }
    private fun connected(destination: InetSocketAddress, local: InetSocketAddress? = null): Socket {
        val socket = newProtectedSocket(local)
        try { socket.connect(destination); return socket }
        catch (error: Exception) { socket.close(); throw error }
    }
    override fun createSocket(): Socket = newProtectedSocket()
    override fun createSocket(host: String, port: Int): Socket = connected(InetSocketAddress(host, port))
    override fun createSocket(host: InetAddress, port: Int): Socket = connected(InetSocketAddress(host, port))
    override fun createSocket(host: String, port: Int, localHost: InetAddress, localPort: Int): Socket =
        connected(InetSocketAddress(host, port), InetSocketAddress(localHost, localPort))
    override fun createSocket(host: InetAddress, port: Int, localHost: InetAddress, localPort: Int): Socket =
        connected(InetSocketAddress(host, port), InetSocketAddress(localHost, localPort))
}

internal object StealthProtocol {
    const val MAX_PACKET = 2048
    private const val PATH = "/stealth-wg"
    // HTTPS WebSocket upgrades travel over TLS on a TCP socket. There is no
    // cleartext or legacy-TLS connection spec to fall back to.
    val TLS_SPEC: ConnectionSpec = ConnectionSpec.Builder(ConnectionSpec.MODERN_TLS)
        .tlsVersions(TlsVersion.TLS_1_3, TlsVersion.TLS_1_2).build()
    val HTTP_PROTOCOLS = listOf(Protocol.HTTP_1_1)

    fun signedUrl(server: String, username: String, psk: String): String {
        val uri = try { URI(server.trim()) } catch (_: Exception) { throw IllegalArgumentException("Enter a valid wss:// relay address.") }
        require(server.length <= 2048 && uri.scheme == "wss" && uri.host != null && uri.userInfo == null &&
            uri.rawQuery == null && uri.fragment == null && (uri.port == -1 || uri.port in 1..65535)) {
            "Stealth VPN requires a wss:// server without embedded credentials or query parameters."
        }
        val user = username.trim()
        require(user.isNotEmpty() && user.length <= 128 && user.none { it.code < 32 } && psk.isNotEmpty() && psk.length <= 512) {
            "Enter the relay username and PSK."
        }
        val timestamp = System.currentTimeMillis().toString()
        val random = ByteArray(12).also { SecureRandom().nextBytes(it) }
        val nonce = random.joinToString("") { "%02x".format(it.toInt() and 0xff) }
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(psk.toByteArray(Charsets.UTF_8), "HmacSHA256"))
        val digest = mac.doFinal("$timestamp.$nonce.$PATH".toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it.toInt() and 0xff) }
        // OkHttp takes an HTTPS URL for a TLS WebSocket; it does not downgrade.
        val base = URI("https", null, uri.host, uri.port, PATH, null, null).toString().toHttpUrl()
        return base.newBuilder().addQueryParameter("user", user)
            .addQueryParameter("auth", "$timestamp.$nonce.$digest").build().toString()
    }

    fun valid(data: ByteArray): Boolean {
        if (data.size !in 4..MAX_PACKET || data[1] != 0.toByte() || data[2] != 0.toByte() || data[3] != 0.toByte()) return false
        return when (data[0].toInt()) {
            1 -> data.size == 148
            2 -> data.size == 92
            3 -> data.size == 64
            4 -> data.size >= 32
            else -> false
        }
    }
}

/** One loopback UDP endpoint, one authenticated WSS connection, no direct fallback. */
internal class StealthBridge(
    service: VpnService,
    private val changed: (String) -> Unit,
) {
    private val stopped = AtomicBoolean(false)
    private val ready = CountDownLatch(1)
    private val udp = DatagramSocket(InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0)).apply { soTimeout = 1000 }
    private val client = OkHttpClient.Builder().socketFactory(ProtectedSocketFactory(service))
        .connectionSpecs(listOf(StealthProtocol.TLS_SPEC)).protocols(StealthProtocol.HTTP_PROTOCOLS)
        .followRedirects(false).followSslRedirects(false).pingInterval(20, TimeUnit.SECONDS)
        .connectTimeout(8, TimeUnit.SECONDS).readTimeout(0, TimeUnit.SECONDS).build()
    @Volatile private var socket: WebSocket? = null
    @Volatile private var peer: InetSocketAddress? = null
    @Volatile var state: String = "connecting"
        private set

    fun start(server: String, user: String, psk: String): Int {
        try {
            val request = Request.Builder().url(StealthProtocol.signedUrl(server, user, psk)).build()
            socket = client.newWebSocket(request, object : WebSocketListener() {
                override fun onMessage(webSocket: WebSocket, text: String) {
                    try {
                        val message = JSONObject(text)
                        if (state != "connecting" || message.optString("type") != "ready" ||
                            message.optString("protocol") != "wireguard-ws" || message.optInt("version") != 1) {
                            fail(); return
                        }
                        state = "connected"
                        changed(state)
                        ready.countDown()
                    } catch (_: Exception) { fail() }
                }
                override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                    val data = bytes.toByteArray()
                    if (!StealthProtocol.valid(data)) { fail(); return }
                    val destination = peer ?: return
                    try { udp.send(DatagramPacket(data, data.size, destination)) } catch (_: Exception) { fail() }
                }
                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) { fail() }
                override fun onClosing(webSocket: WebSocket, code: Int, reason: String) { fail() }
                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) { fail() }
            })
            if (!ready.await(10, TimeUnit.SECONDS) || state != "connected") throw IOException("TLS relay was not ready")
            Thread({ fromWireGuard() }, "openpath-stealth-udp").apply { isDaemon = true; start() }
            return udp.localPort
        } catch (error: Exception) {
            stop()
            // Don't include an OkHttp exception: it may include the signed URL.
            if (error is IllegalArgumentException) throw error
            throw IOException("Could not connect to the TLS relay. Check the server, certificate and credentials.")
        }
    }

    private fun fromWireGuard() {
        val buffer = ByteArray(StealthProtocol.MAX_PACKET + 1)
        try {
            while (!stopped.get()) {
                val packet = DatagramPacket(buffer, buffer.size)
                try { udp.receive(packet) } catch (_: java.net.SocketTimeoutException) { continue }
                if (!packet.address.isLoopbackAddress) continue
                val data = packet.data.copyOfRange(packet.offset, packet.offset + packet.length)
                if (!StealthProtocol.valid(data)) continue
                val source = InetSocketAddress(packet.address, packet.port)
                if (peer == null) peer = source
                if (peer != source) continue
                val ws = socket ?: throw IOException("Relay closed")
                if (ws.queueSize() > 1024 * 1024 || !ws.send(data.toByteString())) throw IOException("Relay is unavailable")
            }
        } catch (_: Exception) { fail() }
    }

    private fun fail() {
        if (!stopped.getAndSet(true)) {
            state = "failed"
            ready.countDown()
            udp.close()
            socket?.cancel()
            client.dispatcher.executorService.shutdown()
            client.connectionPool.evictAll()
            changed(state)
        }
    }
    fun stop() {
        stopped.set(true)
        state = "stopped"
        ready.countDown()
        udp.close()
        socket?.cancel()
        client.dispatcher.executorService.shutdown()
        client.connectionPool.evictAll()
    }
}
