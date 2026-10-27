# Persistent Notification (Always-Present)

Mimics OpenPath VPN screenshot: `Connected to Canada — ↓ 100.94 MB | 2.16 KB/s ↑ 22.14 MB | 2.74 KB/s — Disconnect — always in notification shade / menu bar / tray`.

- `types.ts` — payload, formatters, countries.
- `NotificationManager.ts` — `BaseNotificationManager` + platform adapters (`WebNotificationManager`, `ElectronNotificationManager`, Android `NotificationService`, iOS Live Activity, Windows Action Center, macOS NSUserNotification, Linux libnotify).
- Platform adapters implement `show`/`update`/`hide` (ongoing:true, actions: Disconnect/Open). Core ticks every 1s for speeds.

On connect, VPN engine calls `start(demoCanadaPayload())`; stats updater calls `onStatsUpdate(rx,tx)`; UI mirrors via `openpath:notification` window event.

See per-platform dirs:
- Android `client/android/app/src/main/java/com/openpath/vpn/NotificationService.kt`
- iOS `client/ios/OpenPathVPN/NotificationManager.swift`
- Windows `client/windows/OpenPath/NotificationService.cs`
- macOS `client/macos/OpenPathVPN/NotificationService.swift`
- Linux Electron `client/linux/src/notification-linux.ts`
- Desktop Electron `client/desktop/electron/notification.ts`
