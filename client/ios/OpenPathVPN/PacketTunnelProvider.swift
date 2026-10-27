import NetworkExtension

/**
 * iOS PacketTunnelProvider — tunnels all device traffic via OpenPath stealth protocol.
 * Uses NEPacketTunnelProvider + TUN (packetFlow) bridged to openpath-core (Swift SPM).
 *
 * Build: Xcode 15+ — target iOS 15. Capabilities: Network Extensions (Packet Tunnel).
 * Stealth: identical handshake — SNI = your Cloudflare domain, JA3 = Safari17.
 */
class PacketTunnelProvider: NEPacketTunnelProvider {

    private var core: OpenPathCore?
    private var isRunning = false

    override func startTunnel(options: [String:NSObject]?, completionHandler: @escaping (Error?)->Void) {
        guard let serverUrl = options?["serverUrl"] as? String,
              let psk = options?["psk"] as? String else {
            completionHandler(NSError(domain: "OpenPath", code: 1, userInfo:[NSLocalizedDescriptionKey:"Missing config"]))
            return
        }

        let tunnelSettings = NEPacketTunnelNetworkSettings(tunnelRemoteAddress: "10.89.0.1")
        tunnelSettings.ipv4Settings = NEIPv4Settings(addresses: ["10.89.0.2"], subnetMasks: ["255.255.255.0"])
        tunnelSettings.ipv4Settings?.includedRoutes = [NEIPv4Route.default()]
        tunnelSettings.dnsSettings = NEDNSSettings(servers: ["1.1.1.1"])
        tunnelSettings.mtu = 1420

        setTunnelNetworkSettings(tunnelSettings) { [weak self] error in
            guard error == nil else { completionHandler(error); return }
            self?.connectCore(serverUrl: serverUrl, psk: psk, completion: completionHandler)
        }
    }

    private func connectCore(serverUrl: String, psk: String, completion: @escaping (Error?)->Void) {
        // Real: core = OpenPathCore(serverUrl: serverUrl, psk: psk, transport: .websocketTLS)
        // core?.onPacket = { [weak self] data in self?.packetFlow.writePackets([data], withProtocols: [AF_INET as NSNumber]) }
        // core?.connect { err in completion(err); if err==nil { self?.startReadingTun() } }
        // Mock for demo packaging:
        isRunning = true
        completion(nil)
        startReadingTun()
    }

    private func startReadingTun() {
        packetFlow.readPackets { [weak self] packets, _ in
            guard let self, self.isRunning else { return }
            for pkt in packets {
                // self.core?.send(packet: pkt) // OPSP framing inside
            }
            self.startReadingTun()
        }
    }

    override func stopTunnel(with reason: NEProviderStopReason, completionHandler: @escaping ()->Void) {
        isRunning = false
        core?.disconnect()
        completionHandler()
    }
}

// Minimal core shim (real impl in Sources/OpenPathCore using URLSessionWebSocketTask)
class OpenPathCore {
    var onPacket: ((Data)->Void)?
    func send(packet: Data) {}
    func disconnect() {}
}
