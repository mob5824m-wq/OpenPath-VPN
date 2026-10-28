# Hosting OpenPath VPN on DuckDNS

Host your stealth VPN on `https://YOURNAME.duckdns.org` with automatic TLS (Let's Encrypt via Caddy) and auto IP updates — **free**, no static IP needed. Works from home, Raspberry Pi, dorm PC, or cheap VPS.

---

## Why DuckDNS

| Want | DuckDNS gives |
|---|---|
| Stable URL for school clients | `yourname.duckdns.org` — never changes, even if your IP does |
| Free TLS | Let's Encrypt auto-issue for `*.duckdns.org` via Caddy (HTTP or DNS challenge) |
| No static IP | `duckdns-update.sh` refreshes IP every 5 min |
| Bypass school IP blocklists | Your personal IP never sits on shared VPN blocklists |
| Fortinet-friendly | Still looks like normal HTTPS — `Business / DuckDNS` + `TLS 1.3` |

> **FortiGate sees:** `TLS ClientHello SNI=yourname.duckdns.org` on `443/TCP` — category often `Personal Sites / Dynamic DNS`, not `Proxy Avoidance`. Pair with Caddy → real cert, not self-signed. If your school blocks Dynamic DNS category, see [Fortinet doc](./FORTINET.md) → use `cdn.yourdomain.com` on Cloudflare instead.

---

## 1 — Create your DuckDNS domain (2 min)

1. Go to https://www.duckdns.org → Sign in (GitHub/Google/Reddit/Twitter).
2. Pick a name, e.g. `openpath42` → `openpath42.duckdns.org`. Click **add domain**.
3. Copy your **token** at the top of the DuckDNS page (long hex string).
4. (Optional) If you have a VPS, point it now: your domain should resolve to your public IP after first update (step 3).

> Use one domain per server. You can add up to 5 DuckDNS subdomains per account.

---

## 2 — Prepare your server

You need a machine reachable from the internet on **TCP 443** (and 80 for Let's Encrypt HTTP challenge). Options:

- **Home PC / Raspberry Pi** behind router → forward ports 80 & 443 to it (see step 4).
- **Dorm PC** if NAT allows (or use Cloudflare Tunnel fallback).
- **Free tier VPS** (Oracle, Fly.io, Hetzner €4/mo — no port forwarding needed).

```bash
git clone https://github.com/mob5824m-wq/OpenPath-VPN
cd OpenPath-VPN
```

Set env (never commit your token):

```bash
cp .env.duckdns.example .env
# edit .env: DUCKDNS_DOMAIN=openpath42  DUCKDNS_TOKEN=xxxxxxxx-xxxx-...
nano .env
```

`.env` keys:

```env
DUCKDNS_DOMAIN=openpath42         # without .duckdns.org
DUCKDNS_TOKEN=your-xxx-token
OPS_PATH=/ops
DEMO_PSK=generate-one-via-npm-run-gen-psk
DECOY_TITLE=Alex Rivera — Photography Portfolio
PORT=4433                         # internal; Caddy maps 443→4433
```

Generate a real PSK:

```bash
cd server && npm install && npm run gen-psk
# prints openpath://... — paste PSK into .env DEMO_PSK
```

---

## 3 — Start with automatic TLS (Caddy)

We ship a `docker-compose.duckdns.yml` that runs **Caddy** as TLS terminator in front of the OpenPath server. Caddy does Let's Encrypt automatically for `openpath42.duckdns.org`.

```bash
docker compose -f docker-compose.duckdns.yml up -d --build
# or docker-compose -f docker-compose.duckdns.yml
docker compose -f docker-compose.duckdns.yml logs -f caddy
```

What happens:

- Caddy resolves `openpath42.duckdns.org` → your public IP (DuckDNS must already point there — do one manual update first, see below).
- Caddy requests a Let's Encrypt cert via **HTTP-01** (needs port 80 reachable). If you prefer DNS-01 (no port 80), set `ACME_DNS=duckdns` in `.env` — see comments in compose file.
- Caddy reverse-proxies `https://openpath42.duckdns.org/` → `server:4433` (decoy + WebSocket).
- Unauthenticated `GET /` → portfolio HTML (Shodan = personal site). `GET /ops?auth=...` → 101 WebSocket.

Verify:

```bash
curl -I https://openpath42.duckdns.org/health    # → 200
curl https://openpath42.duckdns.org/ | head        # → portfolio HTML
./scripts/test-stealth.sh --target openpath42.duckdns.org:443
./scripts/test-fortinet.sh --target openpath42.duckdns.org --sni openpath42.duckdns.org
```

If `curl -I https://...` fails with cert error, wait 1-2 min for Let's Encrypt issuance, then `docker logs caddy`.

### Without Docker (systemd + Caddy binary)

```bash
sudo apt install caddy
# Caddyfile is at Caddyfile.duckdns — copy to /etc/caddy/Caddyfile and set env
sudo cp Caddyfile.duckdns /etc/caddy/Caddyfile
sudo sed -i "s/DUCKDNS_DOMAIN/openpath42/g" /etc/caddy/Caddyfile
sudo systemctl restart caddy
cd server && npm install && npm run build && PORT=4433 node dist/index.js
```

---

## 4 — Router port forwarding (home/dorm only)

If your server is behind NAT, forward **TCP 80 and 443** to its LAN IP (e.g. `192.168.1.42`):

- Router admin → NAT / Virtual Server / Port Forwarding → add `80→80`, `443→443`.
- Prefer DHCP reservation for the server so LAN IP doesn't change.
- If your ISP uses CGNAT (no public IPv4), use **Cloudflare Tunnel** fallback: `docker-compose.tunnel.yml`.

Check from outside: https://canyouseeme.org — test ports 80/443 after starting Caddy.

---

## 5 — Keep DuckDNS IP fresh

Your ISP rotates your public IP. DuckDNS must be re-notified. We provide a script + systemd installer:

### Manual test (one-off)

```bash
DUCKDNS_DOMAIN=openpath42 DUCKDNS_TOKEN=xxxx bash scripts/duckdns-update.sh
# → OK  73.12.45.67   (means DuckDNS now points to your current IP)
nslookup openpath42.duckdns.org   # should show your IP
```

### Automatic every 5 minutes (systemd + cron)

```bash
sudo ./scripts/install-duckdns-cron.sh openpath42 xxxxxxxx-token
# installs /etc/systemd/system/duckdns-update.{service,timer} and enables it
systemctl status duckdns-update.timer   # next run in <5m
journalctl -u duckdns-update -f         # logs
```

Or plain cron (alternative):

```bash
(crontab -l 2>/dev/null; echo "*/5 * * * * DUCKDNS_DOMAIN=openpath42 DUCKDNS_TOKEN=xxx $PWD/scripts/duckdns-update.sh >> /var/log/duckdns.log 2>&1") | crontab -
```

The script reads `DUCKDNS_DOMAIN`/`DUCKDNS_TOKEN` from env or `.env`, detects IP via `https://api.ipify.org` (fallback `https://checkip.amazonaws.com`), calls `https://www.duckdns.org/update?domains=...&token=...&ip=...`, prints `OK`/`KO` and logs to `logs/duckdns.log`.

### GitHub Action (optional — deploy box pushes IP)

If your server can reach GitHub Actions runners (or you run self-hosted runner on the box), we ship `duckdns.yml` workflow that:

- on `workflow_dispatch`, `push` to `main`/`arena/**`, **or every 15 min** (`schedule: '*/15 * * * *'`) updates DuckDNS if secrets are set.
- also builds `client/web` and `server` to verify no regressions.

Set GitHub repo secrets: `DUCKDNS_DOMAIN`, `DUCKDNS_TOKEN` (Settings → Secrets → Actions).

You can also run it from any machine: `gh workflow run "DuckDNS Update & Deploy"`.

---

## 6 — Clients: connect to your DuckDNS URL

On any device (school laptop/phone/Chromebook):

```bash
# Linux CLI (or universal client/cli)
openpath config set psk YOUR_PSK
openpath connect --server wss://openpath42.duckdns.org/ops --psk $PSK --profile chrome124

# Fortinet school (adds JA3 fortinet profile + SNI cdn.yourdomain.com + pin):
openpath connect --fortinet --server wss://openpath42.duckdns.org/ops --psk $PSK

# GUI
openpath-gui   # paste wss://openpath42.duckdns.org/ops  + PSK
```

Mobile/Web: set Server = `wss://openpath42.duckdns.org/ops` (443, TLS). The `openpath://` URI works too:

```
openpath://openpath42.duckdns.org:443/ops?psk=YOURPSK&user=demo#DuckDNS
```

Verify in `openpath status`:

```
TLS: 1.3  SNI=openpath42.duckdns.org  JA3=Chrome124  ALPN=h2
TUN: tun0 10.89.0.2/24  (or SOCKS 127.0.0.1:1080)
FortiGate CA: not detected ✅
RX/TX: ↓ 12.3 MB | 45 KB/s  ↑ 1.1 MB
```

Shut down server gracefully:

```bash
docker compose -f docker-compose.duckdns.yml down
# or if systemd: sudo systemctl stop caddy; pkill -f dist/index.js
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `KO` from `duckdns-update.sh` | Wrong token/domain. Copy from duckdns.org; token is per-**account**, domain without `.duckdns.org`. |
| `nslookup` shows old IP | Wait 1 min (DuckDNS TTL 60s). Check script log `logs/duckdns.log`. |
| `curl https://...` → `TLS cert error / self-signed` | Caddy hasn't issued yet. Need port 80 reachable for HTTP-01. Check `docker logs caddy` — if ISP blocks 80, use `ACME_DNS=duckdns` + DNS-01 (set `DUCKDNS_TOKEN` in caddy env — see `.env.duckdns.example`). |
| `connection refused on 443` from school | School firewall blocks non-443? We're on 443. If FortiGate blocks `Dynamic DNS` category, use Cloudflare custom domain instead (see `docs/FORTINET.md` → Cloudflare section) — DuckDNS category is `Dynamic DNS`, some schools block it. Alternative: point a real domain's CNAME to `openpath42.duckdns.org` and use that real domain in clients (same IP, whitelisted category `Business`). |
| CGNAT / no public IP | Can't port-forward. Use `docker-compose.tunnel.yml` (Cloudflare Tunnel) — no DuckDNS needed. Or ZeroTier/Tailscale to your home. |
| GitHub Actions `duckdns` job skipped | Secrets `DUCKDNS_DOMAIN`/`DUCKDNS_TOKEN` not set — job is `if: secrets.DUCKDNS_TOKEN != ''` so it skips on forks/PRs without secrets (expected). Set them in repo Settings → Secrets. |

---

## Bonus: per-sub DuckDNS (multi-host)

Each **sub-host** can have its **own** DuckDNS domain so the app can pick geographically diverse endpoints:

| Host | DuckDNS | Caddy file | Compose |
|---|---|---|---|
| Main | `openpath-main.duckdns.org` | `Caddyfile.duckdns` | `docker-compose.duckdns.yml` |
| Sub 1 | `openpath-sub1.duckdns.org` | `Caddyfile.sub.duckdns` | `docker-compose.sub.duckdns.yml` |
| Sub 2 | `openpath-sub2.duckdns.org` | same | same (different `SUB_DUCKDNS_DOMAIN`) |

Setup per sub:
```bash
# On sub machine — create domain openpath-sub1 at duckdns.org (same token)
cp .env.duckdns.sub.example .env.sub
# edit: SUB_DUCKDNS_DOMAIN=openpath-sub1, DUCKDNS_TOKEN=xxx, MAIN_URL=https://openpath-main.duckdns.org
docker compose --env-file .env.sub -f docker-compose.sub.duckdns.yml up -d --build

# Or without Docker (just advertises the URL):
./setup-sub.sh --main https://openpath-main.duckdns.org --duckdns-domain openpath-sub1 --duckdns-token xxx
```

The sub registers with main as `wss://openpath-sub1.duckdns.org/ops` + `duckdnsUrl: https://openpath-sub1.duckdns.org`, visible in `GET /api/hosts`.

## Files added for DuckDNS

- `docker-compose.duckdns.yml` + `Caddyfile.duckdns` — Main host TLS for `*.duckdns.org`
- `docker-compose.sub.duckdns.yml` + `Caddyfile.sub.duckdns` — Per-sub host TLS (each sub own domain)
- `.env.duckdns.example` + `.env.duckdns.sub.example` — env templates
- `scripts/duckdns-update.sh` + `scripts/install-duckdns-cron.sh` — IP updater + systemd installer
- `.github/workflows/duckdns.yml` — scheduled updater + deploy + build check
- Auto-tag workflow: pushes to `main` bump version `v1.0→v1.1` and trigger installer release

---

## Next: harden for Fortinet

Once DuckDNS works, run `./scripts/test-fortinet.sh --target openpath42.duckdns.org` and see `docs/FORTINET.md` for `--fortinet` profile (JA3 mimicry, FortiGuard category Business, explicit proxy CONNECT, Deep Inspection inner encryption).
