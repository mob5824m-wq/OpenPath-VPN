package com.openpath.vpn

import com.wireguard.config.Config
import com.wireguard.config.InetAddresses
import com.wireguard.config.Interface
import com.wireguard.config.Peer
import java.io.ByteArrayInputStream
import java.net.Inet4Address
import java.net.Inet6Address
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction

/** Only full-device profiles are accepted; wg-quick scripts and app exclusions are not. */
object ProfileValidator {
    const val MAX_BYTES = 65536
    private val interfaceKeys = setOf("privatekey", "address", "dns", "mtu", "listenport")
    private val peerKeys = setOf("publickey", "presharedkey", "endpoint", "allowedips", "persistentkeepalive")

    fun parse(bytes: ByteArray): Config {
        require(bytes.isNotEmpty() && bytes.size <= MAX_BYTES) { "Profile is empty or exceeds 64 KiB." }
        val text = try {
            Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString()
        } catch (_: Exception) {
            throw IllegalArgumentException("Profile must be valid UTF-8 text.")
        }
        var section = ""
        var sawInterface = false
        var sawPeer = false
        val seen = mutableSetOf<String>()
        for (raw in text.lineSequence()) {
            val line = raw.substringBefore('#').trim()
            if (line.isEmpty()) continue
            if (line.startsWith("[")) {
                when (line.lowercase()) {
                    "[interface]" -> {
                        require(!sawInterface && !sawPeer) { "Use one Interface followed by one Peer." }
                        sawInterface = true
                        section = "interface"
                    }
                    "[peer]" -> {
                        require(sawInterface && !sawPeer) { "Use one Interface followed by one Peer." }
                        sawPeer = true
                        section = "peer"
                    }
                    else -> throw IllegalArgumentException("Unsupported profile section.")
                }
                continue
            }
            val equals = line.indexOf('=')
            require(section.isNotEmpty() && equals > 0 && line.substring(equals + 1).isNotBlank()) {
                "Invalid profile line."
            }
            val key = line.substring(0, equals).trim().lowercase()
            val allowed = if (section == "interface") interfaceKeys else peerKeys
            require(key in allowed) { "Profile contains an unsupported or unsafe directive." }
            require(seen.add("$section:$key")) { "Profile contains a duplicate directive." }
        }
        require(sawInterface && sawPeer) { "A profile needs an Interface and a Peer." }
        require(setOf("interface:privatekey", "interface:address", "peer:publickey", "peer:endpoint", "peer:allowedips").all { it in seen }) {
            "Profile needs keys, an address, an endpoint and allowed IPs."
        }
        val config = try {
            Config.parse(ByteArrayInputStream(bytes))
        } catch (_: Exception) {
            // Parse exceptions may contain profile text (including a private key). Never display them.
            throw IllegalArgumentException("Invalid WireGuard profile. Check keys, addresses and endpoint.")
        }
        val iface = config.`interface`
        require(iface.addresses.any { it.address is Inet4Address }) { "An IPv4 interface address is required." }
        require(iface.dnsSearchDomains.isEmpty()) { "Profile DNS entries must be IP addresses." }
        require(config.peers.size == 1 && config.peers[0].endpoint.isPresent) { "One peer with an endpoint is required." }
        val routes = config.peers[0].allowedIps
        require(routes.size == 2 &&
            routes.any { it.address is Inet4Address && it.address.isAnyLocalAddress && it.mask == 0 } &&
            routes.any { it.address is Inet6Address && it.address.isAnyLocalAddress && it.mask == 0 }) {
            "Device-wide profiles must route both 0.0.0.0/0 and ::/0."
        }
        require(!iface.mtu.isPresent || iface.mtu.get() in 576..9000) { "MTU must be between 576 and 9000." }
        return config
    }

    /** Change only the endpoint; the TLS relay is a local WireGuard datagram bridge. */
    fun withStealthEndpoint(config: Config, port: Int): Config {
        require(port in 1..65535) { "Invalid local relay port." }
        val original = config.peers.single()
        val peer = Peer.Builder().setPublicKey(original.publicKey).addAllowedIps(original.allowedIps)
            .parseEndpoint("127.0.0.1:$port")
        original.preSharedKey.ifPresent { peer.setPreSharedKey(it) }
        original.persistentKeepalive.ifPresent { peer.setPersistentKeepalive(it) }
        return Config.Builder().setInterface(config.`interface`).addPeer(peer.build()).build()
    }

    /** Rebuild only the interface DNS; never alter the peer, keys or routes. */
    fun withDns(config: Config, mode: String, custom: String): Config {
        val original = config.`interface`
        val addresses = when (mode) {
            "profile" -> if (original.dnsServers.isNotEmpty()) original.dnsServers.toList()
                else listOf(InetAddresses.parse("1.1.1.1"), InetAddresses.parse("1.0.0.1"))
            "malware" -> listOf(InetAddresses.parse("9.9.9.9"), InetAddresses.parse("149.112.112.112"))
            "ads" -> listOf(InetAddresses.parse("94.140.14.14"), InetAddresses.parse("94.140.15.15"))
            "custom" -> {
                val parts = custom.split(',').map { it.trim() }.filter { it.isNotEmpty() }
                require(parts.isNotEmpty() && parts.size <= 8 && parts.none { '%' in it }) {
                    "Enter one to eight DNS IP addresses separated by commas."
                }
                try { parts.map { InetAddresses.parse(it) } }
                catch (_: Exception) { throw IllegalArgumentException("Custom DNS must contain IP addresses, not hostnames.") }
            }
            else -> throw IllegalArgumentException("Select a DNS mode.")
        }
        val builder = Interface.Builder().setKeyPair(original.keyPair)
            .addAddresses(original.addresses).addDnsServers(addresses)
        original.listenPort.ifPresent { builder.setListenPort(it) }
        original.mtu.ifPresent { builder.setMtu(it) }
        return Config.Builder().setInterface(builder.build()).addPeers(config.peers).build()
    }
}
