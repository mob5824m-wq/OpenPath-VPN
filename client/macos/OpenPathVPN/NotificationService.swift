// macOS persistent notification — NSUserNotificationCenter (macOS 12+) + Notification Center
// Like Proton VPN mac menu bar persistent: OpenPath icon in menu bar, banner stays in Notification Center
import UserNotifications
import AppKit

class MacNotificationService {
    static let shared = MacNotificationService()
    func requestAuth() { UNUserNotificationCenter.current().requestAuthorization(options: [.alert,.sound,.badge]){_ ,_ in} }

    func postConnected(flag: String="🇨🇦", country:String="Canada", rx:String="100.94 MB", rxSpeed:String="2.16 KB/s", tx:String="22.14 MB", txSpeed:String="2.74 KB/s") {
        let content = UNMutableNotificationContent()
        content.title = "\(flag) Connected to \(country)"
        content.subtitle = "OpenPath VPN — GhostPath"
        content.body = "↓ \(rx) | \(rxSpeed)   ↑ \(tx) | \(txSpeed)"
        content.categoryIdentifier = "VPN_CONNECTED_MAC"
        let disc = UNNotificationAction(identifier: "DISCONNECT", title: "Disconnect", options: .destructive)
        let open = UNNotificationAction(identifier: "OPEN", title: "Open OpenPath", options: .foreground)
        let cat = UNNotificationCategory(identifier: "VPN_CONNECTED_MAC", actions: [disc, open], intentIdentifiers: [])
        UNUserNotificationCenter.current().setNotificationCategories([cat])
        let req = UNNotificationRequest(identifier: "openpath.connected", content: content, trigger: nil)
        UNUserNotificationCenter.current().add(req)
        // Also update menu bar extra (NSStatusItem tooltip) via AppDelegate
        if let app = NSApp.delegate as? AppDelegate { app.updateMenuBarTooltip("\(flag) Connected to \(country) — ↓ \(rx) ↑ \(tx)") }
    }
    func hide() { UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: ["openpath.connected"]) }
}
// Minimal stub for AppDelegate reference
class AppDelegate: NSObject { func updateMenuBarTooltip(_ s:String) { print(s) } }
