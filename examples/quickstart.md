# Quickstart — Connect in 60 seconds

## 1. Start server (decoy + stealth VPN)
```bash
docker compose up -d
# or
cd server && npm i && npm run dev
```
Check: `curl http://localhost:4433/` → portfolio HTML (decoy).  
`curl http://localhost:4433/health` → JSON ok.

## 2. Provision user
```bash
curl -X POST http://localhost:4433/api/provision -H "Content-Type: application/json" -d '{"user":"alice"}'
# → { user:"alice", psk:"...", wsUrl:"wss://host/ops?auth=...&user=alice", uri:"openpath://..." }
```
Share `openpath://` URI via QR code shown in dashboard.

## 3. Connect client
Open `http://localhost:5173` → paste `Server` + `PSK` + `User` → **Connect**.
- Watch logs: TLS mimic, handshake, padding, jitter.
- Try **Fetch via VPN** with `https://example.com` → egress via server, invisible to DPI.

## 4. Native clients
- Windows: `client/windows/README.md`
- macOS: `client/macos/README.md`
- Android: `client/android/README.md`
- iOS: `client/ios/README.md`

## Troubleshooting
- School blocks WebSocket upgrade? Client auto-fails to H2-stream then DoH.
- Got 404 on `/ops`? HMAC expired (30s) — client auto-rebuilds token each connect.
- 5 bad auths → tarpit 5 min — wait or change IP.

