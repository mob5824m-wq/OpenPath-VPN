// iOS Persistent Notification + Live Activity (iOS 16+) — mirrors Proton's always-present banner
// SwiftUI Widget / Live Activity shows: Connected to Canada, ↓ 100.94 MB | 2.16 KB/s etc.
// Proton uses push-less local LiveActivity for VPN; we replicate via ActivityKit + App Group.
//

import UserNotifications
import ActivityKit

struct VPNLiveAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var countryFlag: String
        var countryName: String
        var downMB: String
        var downSpeed: String
        var upMB: String
        var upSpeed: String
        var duration: String
        var ip: String
    }
    var profile: String
}

class OpenPathNotificationCenter {
    static let shared = OpenPathNotificationCenter()

    func requestPermission() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in }
    }

    // Foreground persistent banner (cannot be swiped while VPN tunnel is active — re-post on dismiss)
    func postConnected(countryFlag: String = "🇨🇦", country: String = "Canada", rx: String = "100.94 MB", rxSpeed: String = "2.16 KB/s", tx: String = "22.14 MB", txSpeed: String = "2.74 KB/s") {
        let content = UNMutableNotificationContent()
        content.title = "\(countryFlag) Connected to \(country)"
        content.subtitle = "OpenPath VPN"
        content.body = "↓ \(rx) | \(rxSpeed)  ↑ \(tx) | \(txSpeed)"
        content.categoryIdentifier = "VPN_CONNECTED"
        content.sound = nil
        content.interruptionLevel = .active
        // actions
        let disconnect = UNNotificationAction(identifier: "DISCONNECT", title: "Disconnect", options: .destructive)
        let open = UNNotificationAction(identifier: "OPEN", title: "Open", options: .foreground)
        let category = UNNotificationCategory(identifier: "VPN_CONNECTED", actions: [disconnect, open], intentIdentifiers: [])
        UNUserNotificationCenter.current().setNotificationCategories([category])
        // deliver immediately, sticky
        let req = UNNotificationRequest(identifier: "openpath.connected", content: content, trigger: nil)
        UNUserNotificationCenter.current().add(req)
        startLiveActivity(countryFlag: countryFlag, country: country, downMB: rx, downSpeed: rxSpeed, upMB: tx, upSpeed: txSpeed)
    }

    func clear() {
        UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: ["openpath.connected"])
        Task { await endLiveActivity() }
    }

    // Live Activity (lock screen persistent)
    private var activity: Activity<VPNLiveAttributes>?
    func startLiveActivity(countryFlag: String, country: String, downMB: String, downSpeed: String, upMB: String, upSpeed: String) {
        guard #available(iOS 16.1, *) else { return }
        if !ActivityAuthorizationInfo().areActivitiesEnabled { return }
        let attrs = VPNLiveAttributes(profile: "OpenPath")
        let state = VPNLiveAttributes.ContentState(countryFlag: countryFlag, countryName: country, downMB: downMB, downSpeed: downSpeed, upMB: upMB, upSpeed: upSpeed, duration: "05:42", ip: "185.159.157.12")
        do { activity = try Activity.request(attributes: attrs, content: .init(state: state, staleDate: nil)) } catch { print("LiveActivity err \(error)") }
    }
    func updateLiveActivity(downMB: String, downSpeed: String, upMB: String, upSpeed: String) {
        guard #available(iOS 16.1, *) else { return }
        Task { await activity?.update(using: VPNLiveAttributes.ContentState(countryFlag: "🇨🇦", countryName: "Canada", downMB: downMB, downSpeed: downSpeed, upMB: upMB, upSpeed: upSpeed, duration: "05:43", ip: "185.159.157.12")) }
    }
    func endLiveActivity() async {
        guard #available(iOS 16.1, *) else { return }
        for a in Activity<VPNLiveAttributes>.activities { await a.end(nil, dismissalPolicy: .immediate) }
    }
}
