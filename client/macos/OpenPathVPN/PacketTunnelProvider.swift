import NetworkExtension
// macOS uses same NEPacketTunnelProvider as iOS but distributed as System Extension
// See ios/PacketTunnelProvider.swift — identical core, different entitlements
// macOS additionally supports utun via `open VPN` button in System Settings → Network
