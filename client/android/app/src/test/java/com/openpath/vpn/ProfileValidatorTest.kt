package com.openpath.vpn

import android.util.Base64
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.io.ByteArrayInputStream
import javax.crypto.spec.SecretKeySpec

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class ProfileValidatorTest {
    private val profile = """
        [Interface]
        PrivateKey = AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=
        Address = 10.7.0.2/24, fd00::2/64
        DNS = 10.7.0.1

        [Peer]
        PublicKey = AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI=
        Endpoint = vpn.example.com:51820
        AllowedIPs = 0.0.0.0/0, ::/0
        PersistentKeepalive = 25
    """.trimIndent()

    private fun parse(value: String = profile) = ProfileValidator.parse(value.toByteArray())

    @Test fun validFullDeviceProfileAndDnsModes() {
        val config = parse()
        assertEquals(1, config.peers.size)
        assertEquals("10.7.0.1", ProfileValidator.withDns(config, "profile", "").`interface`.dnsServers.first().hostAddress)
        assertEquals(setOf("9.9.9.9", "149.112.112.112"), ProfileValidator.withDns(config, "malware", "").`interface`.dnsServers.map { it.hostAddress }.toSet())
        assertEquals(setOf("94.140.14.14", "94.140.15.15"), ProfileValidator.withDns(config, "ads", "").`interface`.dnsServers.map { it.hostAddress }.toSet())
        val custom = ProfileValidator.withDns(config, "custom", "1.1.1.1, 8.8.8.8")
        assertEquals(config.peers, custom.peers)
        assertEquals(config.`interface`.keyPair, custom.`interface`.keyPair)
        assertEquals(setOf("1.1.1.1", "8.8.8.8"), custom.`interface`.dnsServers.map { it.hostAddress }.toSet())
        assertThrows(IllegalArgumentException::class.java) { ProfileValidator.withDns(config, "custom", "example.com") }
        assertThrows(IllegalArgumentException::class.java) { ProfileValidator.withDns(config, "custom", "") }
        assertThrows(IllegalArgumentException::class.java) { ProfileValidator.withDns(config, "custom", "fe80::1%wlan0") }
    }

    @Test fun stealthPreservesPeerAndInterfaceWithoutAppExclusions() {
        val original = parse()
        val relay = ProfileValidator.withStealthEndpoint(original, 45678)
        assertEquals(original.`interface`, relay.`interface`)
        assertTrue(relay.`interface`.excludedApplications.isEmpty())
        assertEquals(original.peers[0].allowedIps, relay.peers[0].allowedIps)
        assertEquals(original.peers[0].publicKey, relay.peers[0].publicKey)
        assertEquals("127.0.0.1:45678", relay.peers[0].endpoint.get().toString())
        assertThrows(IllegalArgumentException::class.java) { ProfileValidator.withStealthEndpoint(original, 0) }
        val largeMtu = parse(profile.replace("DNS = 10.7.0.1", "DNS = 10.7.0.1\nMTU = 2000"))
        assertThrows(IllegalArgumentException::class.java) { ProfileValidator.withStealthEndpoint(largeMtu, 45678) }
    }

    @Test fun stealthRequiresTlsAndSignsTheExactRelayPath() {
        val url = java.net.URI(StealthProtocol.signedUrl("wss://relay.example/ops", "test-user", "test-secret"))
        assertEquals("https", url.scheme)
        assertEquals("/stealth-wg", url.path)
        val query = url.rawQuery.split('&').associate { part ->
            val pair = part.split('=', limit = 2)
            java.net.URLDecoder.decode(pair[0], "UTF-8") to java.net.URLDecoder.decode(pair[1], "UTF-8")
        }
        assertEquals("test-user", query["user"])
        val parts = query.getValue("auth").split('.')
        assertEquals(3, parts.size)
        val mac = javax.crypto.Mac.getInstance("HmacSHA256")
        mac.init(javax.crypto.spec.SecretKeySpec("test-secret".toByteArray(), "HmacSHA256"))
        val expected = mac.doFinal("${parts[0]}.${parts[1]}.${url.path}".toByteArray())
            .joinToString("") { "%02x".format(it.toInt() and 0xff) }
        assertEquals(expected, parts[2])
        assertThrows(IllegalArgumentException::class.java) { StealthProtocol.signedUrl("ws://relay.example", "u", "p") }
        assertThrows(IllegalArgumentException::class.java) { StealthProtocol.signedUrl("wss://relay.example/?auth=x", "u", "p") }
        val packet = ByteArray(148).also { it[0] = 1 }
        assertTrue(StealthProtocol.valid(packet))
        assertFalse(StealthProtocol.valid(ByteArray(4096)))
    }

    @Test fun fallbackDnsAndInvalidProfiles() {
        val noDns = parse(profile.replace("DNS = 10.7.0.1", ""))
        assertEquals(setOf("1.1.1.1", "1.0.0.1"), ProfileValidator.withDns(noDns, "profile", "").`interface`.dnsServers.map { it.hostAddress }.toSet())
        val invalid = listOf(
            profile.replace("0.0.0.0/0, ::/0", "0.0.0.0/0"),
            profile.replace("0.0.0.0/0, ::/0", "0.0.0.0/0, ::/0, 10.0.0.0/8"),
            profile.replace("DNS = 10.7.0.1", "PostUp = touch /tmp/fake"),
            profile.replace("DNS = 10.7.0.1", "ExcludedApplications = org.example"),
            profile.replace("DNS = 10.7.0.1", "DNS = example.com"),
            profile.replace("Address =", "PrivateKey = hidden\nAddress ="),
            profile.replace("AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=", "bad-private-key"),
            profile + "\n[Peer]\nPublicKey = AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI=",
        )
        for (candidate in invalid) {
            val error = assertThrows(IllegalArgumentException::class.java) { parse(candidate) }
            assertFalse("Error messages must not leak private keys", error.message.orEmpty().contains("bad-private-key"))
        }
        assertThrows(IllegalArgumentException::class.java) { ProfileValidator.parse(ByteArray(ProfileValidator.MAX_BYTES + 1)) }
        assertThrows(IllegalArgumentException::class.java) { ProfileValidator.parse(byteArrayOf(0xC3.toByte())) }
    }

    @Test fun boundedInputRejectsOversize() {
        assertEquals(3, TunnelManager.readBounded(ByteArrayInputStream(byteArrayOf(1, 2, 3))).size)
        assertThrows(Exception::class.java) { TunnelManager.readBounded(ByteArrayInputStream(ByteArray(ProfileValidator.MAX_BYTES + 1))) }
    }

    @Before fun clearPrefs() {
        RuntimeEnvironment.getApplication().getSharedPreferences("wireguard_profile", 0).edit().clear().commit()
    }

    @Test fun profileIsEncryptedAuthenticatedAndRemovable() {
        val context = RuntimeEnvironment.getApplication()
        val key = SecretKeySpec(ByteArray(32) { it.toByte() }, "AES")
        val store = SecureProfileStore(context) { key }
        val plain = profile.toByteArray()
        store.save(plain)
        assertTrue(store.exists())
        val preferences = context.getSharedPreferences("wireguard_profile", 0)
        val encrypted = Base64.decode(preferences.getString("ciphertext", ""), Base64.NO_WRAP)
        assertFalse(encrypted.contentEquals(plain))
        assertFalse(String(encrypted, Charsets.ISO_8859_1).contains("PrivateKey"))
        assertArrayEquals(plain, store.load())
        encrypted[encrypted.lastIndex] = (encrypted.last().toInt() xor 1).toByte()
        preferences.edit().putString("ciphertext", Base64.encodeToString(encrypted, Base64.NO_WRAP)).commit()
        assertThrows(Exception::class.java) { store.load() }
        store.remove()
        assertFalse(store.exists())
    }
}
