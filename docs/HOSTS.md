# Main + Sub-Hosts Architecture (with per-host DuckDNS)

> **Problem:** One VPN server can be blocked or overloaded.  
> **Solution:** Run a **main host** (directory) that knows all **sub-hosts** (workers). App connects to main → gets live host list → picks best sub for VPN. Each sub can have its own `*.duckdns.org`.

```
 App ──GET /api/hosts──► Main Host (4433 / main.duckdns.org) ──registry──► Sub Hosts (each with own duckdns)
  │                           ▲                              │
  │                           │ register/heartbeat           │
  └─wss://sub1.duckdns.org/ops┴──────────────────────────────┘
  └─wss://sub2.duckdns.org/ops ──VPN tunnel (egress)──► Internet
```

---

## How it works

| Component | Role | What it does |
|---|---|---|
| **Main host** `ROLE=main` | Directory | Maintains in-memory registry of sub-hosts (`/api/hosts`), prunes stale entries (TTL 75s), health-checks subs, serves decoy site. Has its own DuckDNS `main.duckdns.org` via `docker-compose.duckdns.yml`. |
| **Sub host** `ROLE=sub` | Worker | Runs full VPN egress on its own port, registers with `MAIN_URL` via `POST /api/hosts/register`, sends `POST /api/hosts/heartbeat` every 25s. **Each sub can have its own DuckDNS** `sub1.duckdns.org` via `docker-compose.sub.duckdns.yml`. |
| **App** | Client | First `GET https://main.duckdns.org/api/hosts` (or via localhost), shows list, user picks, then `wss://sub1.duckdns.org/ops?psk=...` for VPN. |

### APIs

**Main → App:**
```
GET /api/hosts          → { main: {id, wssUrl,...}, hosts: [{id, name, host, port, wssUrl, duckdnsUrl, region, flag, load, latencyMs, online},...], total, online }
GET /api/hosts?all=1    → include offline
GET /api/hosts?region=home
POST /api/provision {user:"demo"} → also includes hosts
```

**Sub → Main:**
```
POST /api/hosts/register  {id, name, host, port, wssUrl, duckdnsUrl, publicUrl, region, country, flag, capacity}
POST /api/hosts/heartbeat {id}
POST /api/hosts/unregister {id}
```

All open (no secret) for demo; add `Authorization: Bearer $PSK` header if you fork.

---

## Quick start — two machines (or two terminals on one)

### One-liner after `git clone`

**Terminal 1 — Main (laptop, VPS, Raspberry Pi):**
```bash
# any of these:
python setup-main.py
./setup-main.sh
setup-main.bat

# With DuckDNS in docker:
cp .env.duckdns.example .env
# edit DUCKDNS_DOMAIN=main, DUCKDNS_TOKEN=xxx
docker compose -f docker-compose.duckdns.yml up -d --build

# App then uses https://main.duckdns.org/api/hosts
```

Main prints:
```
Health:  http://localhost:4433/health
Hosts:   http://localhost:4433/api/hosts   ← app
LAN:     http://192.168.1.10:4433/api/hosts
Subs run: python setup-sub.py --main http://192.168.1.10:4433 --port 4434
```

**Terminal 2 — Sub (another PC, VM, friend's house):**
```bash
# Simple (local IP):
python setup-sub.py --main http://192.168.1.10:4433
./setup-sub.sh --main http://192.168.1.10:4433
setup-sub.bat --main http://192.168.1.10:4433

# With its OWN DuckDNS (recommended for public):
python setup-sub.py --main https://main.duckdns.org --duckdns-domain openpath-sub1 --duckdns-token YOUR_TOKEN
./setup-sub.sh --main https://main.duckdns.org --duckdns-domain openpath-sub1 --duckdns-token YOUR_TOKEN

# Docker sub with DuckDNS (on another VPS):
cp .env.duckdns.sub.example .env.sub
# edit SUB_DUCKDNS_DOMAIN=openpath-sub1, DUCKDNS_TOKEN=xxx, MAIN_URL=https://main.duckdns.org
docker compose --env-file .env.sub -f docker-compose.sub.duckdns.yml up -d --build
```

App sees: `wss://openpath-sub1.duckdns.org/ops` for that sub.

**App / curl:**
```bash
curl http://192.168.1.10:4433/api/hosts | python3 -m json.tool
# → { main: {...}, hosts: [{id:"sub-...", wssUrl:"wss://openpath-sub1.duckdns.org/ops", duckdnsUrl:"https://openpath-sub1.duckdns.org", ...}], total:1, online:1 }
```

### Same machine demo (two ports)
```bash
python setup-main.py --port 4433
python setup-sub.py --main http://localhost:4433 --port 4434 --public-host 127.0.0.1
curl http://localhost:4433/api/hosts
```

---

## Setup scripts — two sets

| For | Python | Bash | Batch |
|---|---|---|---|
| **Main** (directory) | `setup-main.py` | `setup-main.sh` | `setup-main.bat` |
| **Sub** (worker) | `setup-sub.py` | `setup-sub.sh` | `setup-sub.bat` |

| Arg | Main | Sub |
|---|---|---|
| `--port` | 4433 | 4434 |
| `--main` | — | `http://MAIN:4433` **required** |
| `--duckdns-domain` | `DUCKDNS_DOMAIN` env | Sub's own DuckDNS subdomain (e.g. `openpath-sub1`) |
| `--duckdns-token` | `DUCKDNS_TOKEN` | Same DuckDNS token |
| `--public-host` | auto LAN IP | auto LAN IP (or duckdns.org if using DuckDNS) |
| `--docker` | — | Use `docker-compose.sub.duckdns.yml` for this sub |

Env also works: `PORT/HOST/ROLE/MAIN_URL/DUCKDNS_DOMAIN/SUB_DUCKDNS_DOMAIN`

---

## DuckDNS per host

- **Main:** `Caddyfile.duckdns` + `docker-compose.duckdns.yml` → `{$DUCKDNS_DOMAIN}.duckdns.org`
- **Sub:** `Caddyfile.sub.duckdns` + `docker-compose.sub.duckdns.yml` → `{$SUB_DUCKDNS_DOMAIN}.duckdns.org`
- Each must run on **separate machine** so ports 80/443 don't conflict. For local testing use `--duckdns-domain` without Docker (just sets WSS URL, no Caddy).
- All use same `DUCKDNS_TOKEN` from duckdns.org.

Flow for sub DuckDNS registration:
1. Sub starts with `DUCKDNS_DOMAIN=openpath-sub1`
2. Sub's `getSubConfig()` builds `wss://openpath-sub1.duckdns.org/ops` and `https://openpath-sub1.duckdns.org`
3. Sub POSTs `register` with `wssUrl` + `duckdnsUrl` to main
4. Main's `registry.ts` stores `duckdnsUrl` and uses it for effective WSS if present
5. App `GET /api/hosts` returns sub with `wssUrl: "wss://openpath-sub1.duckdns.org/ops"` + `duckdnsUrl: "https://openpath-sub1.duckdns.org"`

---

## Client integration (app)

```ts
const main = "https://main.duckdns.org";
const res = await fetch(`${main}/api/hosts`);
const { main: m, hosts } = await res.json();
const chosen = hosts[0];
const ws = new WebSocket(`${chosen.wssUrl}?auth=${token}&user=demo`);
```

Fallback: main itself can also serve VPN (connect to `main.wssUrl` if no subs online).
