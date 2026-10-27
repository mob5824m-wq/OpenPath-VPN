#!/usr/bin/env python3
"""
OpenPath VPN — one-command server setup (cross-platform)
  git clone https://github.com/mob5824m-wq/OpenPath-VPN && cd OpenPath-VPN
  python setup.py          # or python3 setup.py
No secrets needed — auto-installs deps, builds, generates PSK, starts server.
Works on Windows / macOS / Linux. Requires Node.js 18+ and npm.
"""
import os, sys, subprocess, platform, secrets, pathlib, shutil, time, socket, webbrowser

ROOT = pathlib.Path(__file__).parent.resolve()
SERVER = ROOT / "server"
DEFAULT_PORT = 4433
DEFAULT_PSK = "demo-student-key-do-not-use-prod"

BOLD = "\033[1m" if os.name != "nt" else ""
GREEN = "\033[92m" if os.name != "nt" else ""
CYAN = "\033[96m" if os.name != "nt" else ""
YELLOW = "\033[93m" if os.name != "nt" else ""
RED = "\033[91m" if os.name != "nt" else ""
RESET = "\033[0m" if os.name != "nt" else ""

def log(msg, color=""):
    print(f"{color}{msg}{RESET}")

def run(cmd, cwd=None, env=None, check=True):
    log(f"  $ {cmd}", CYAN)
    merged = os.environ.copy()
    if env: merged.update(env)
    # shell=True for npm/npx on Windows
    result = subprocess.run(cmd, cwd=str(cwd) if cwd else None, env=merged, shell=True)
    if check and result.returncode != 0:
        raise SystemExit(f"Command failed ({result.returncode}): {cmd}")
    return result

def check_node():
    log("\n[1/5] Checking Node.js + npm ...", BOLD)
    node = shutil.which("node")
    npm = shutil.which("npm")
    if not node or not npm:
        log("  Node.js not found. Install from https://nodejs.org (v18+ required)", RED)
        log("  After installing, re-run: python setup.py", YELLOW)
        sys.exit(1)
    v = subprocess.check_output("node -v", shell=True, text=True).strip()
    log(f"  Found Node {v} + npm {subprocess.check_output('npm -v', shell=True, text=True).strip()}", GREEN)
    major = int(v.lstrip('v').split('.')[0])
    if major < 18:
        log(f"  Warning: Node {v} < 18, may fail. Upgrade recommended.", YELLOW)

def install_and_build():
    log("\n[2/5] Installing server dependencies ...", BOLD)
    if not (SERVER / "package.json").exists():
        log(f"  server/package.json not found at {SERVER}", RED)
        sys.exit(1)
    run("npm install", cwd=SERVER)
    log("\n[3/5] Building server (TypeScript -> dist) ...", BOLD)
    # tsc via npm script, fallback to npx
    r = subprocess.run("npm run build", cwd=str(SERVER), shell=True)
    if r.returncode != 0:
        log("  npm run build failed, trying npx tsc ...", YELLOW)
        run("npx tsc --outDir dist", cwd=SERVER)

def gen_psk():
    # 32 random bytes base64url
    psk = secrets.token_urlsafe(32)
    log(f"\n[4/5] Generated fresh PSK: {psk}", GREEN)
    log(f"  (demo PSK also works: {DEFAULT_PSK})", CYAN)
    return psk

def pick_port(preferred=DEFAULT_PORT):
    # try preferred, else find free port
    s = socket.socket()
    try:
        s.bind(("0.0.0.0", preferred))
        s.close()
        return preferred
    except OSError:
        log(f"  Port {preferred} busy, picking free port ...", YELLOW)
        s2 = socket.socket()
        s2.bind(("0.0.0.0", 0))
        p = s2.getsockname()[1]
        s2.close()
        return p

def print_info(port, psk, host="localhost"):
    ws_url = f"wss://{host}:{port}/ops?psk={psk}&user=demo"
    # openpath URI format used by clients
    uri = f"openpath://{host}:{port}/ops?psk={psk}&user=demo#demo"
    # local IP guess
    try:
        hostname = socket.gethostname()
        local_ip = socket.gethostbyname(hostname)
    except: local_ip = host
    log("\n" + "="*62, GREEN)
    log("  OpenPath VPN Server is ready!  (no secrets needed)", GREEN+BOLD)
    log("="*62, GREEN)
    log(f"  Health:  http://{host}:{port}/health", CYAN)
    log(f"  Decoy:   http://{host}:{port}/  (shows portfolio)", CYAN)
    log(f"  Stats:   http://{host}:{port}/api/stats", CYAN)
    log(f"  Provision: POST http://{host}:{port}/api/provision  {{\"user\":\"demo\"}}", CYAN)
    log(f"\n  PSK (share with clients): {psk}", BOLD)
    log(f"  WSS URL: {ws_url}", YELLOW)
    log(f"  URI:     {uri}", YELLOW)
    log(f"\n  Clients connect with:", BOLD)
    log(f"    openpath connect --server wss://{host}:{port}/ops --psk {psk}", CYAN)
    log(f"    or use URI above in any OpenPath client")
    log(f"\n  LAN access (for phones/other devices):", BOLD)
    log(f"    http://{local_ip}:{port}/  and  wss://{local_ip}:{port}/ops", CYAN)
    log(f"  To expose on DuckDNS: see docs/DUCKDNS.md", CYAN)
    log(f"  To use Docker: docker compose up -d", CYAN)
    log("="*62 + "\n", GREEN)
    return ws_url, uri, local_ip

def main():
    import argparse
    ap = argparse.ArgumentParser(description="OpenPath VPN server setup — no secrets")
    ap.add_argument("--port", type=int, default=None, help="Port to listen on (default 4433)")
    ap.add_argument("--host", default="0.0.0.0", help="Host to bind (default 0.0.0.0)")
    ap.add_argument("--psk", default=None, help="PSK to use (default: auto-generated)")
    ap.add_argument("--no-build", action="store_true", help="Skip npm install/build (use existing dist)")
    ap.add_argument("--docker", action="store_true", help="Use docker compose instead of node")
    ap.add_argument("--open", action="store_true", help="Open health URL in browser after start")
    args = ap.parse_args()

    log(r"""
  ___                    ____        _   _     __   ____  _   _
 / _ \  _ __    ___  _  |  _ \  __ _| |_| |__  \ \ / / _ \| \ | |
| | | || '_ \  / _ \| '_|| |_) |/ _` | __| '_ \  \ V / | | |  \| |
| |_| || |_) ||  __/| |  |  __/| (_| | |_| | | |  | |  |_| | |\  |
 \___/ | .__/  \___||_|  |_|    \__,_|\__|_| |_|  |_| \___/|_| \_|
       |_|      GhostPath stealth VPN — git clone & go
    """, CYAN)

    log(f"Platform: {platform.system()} {platform.release()}  Python {platform.python_version()}", BOLD)
    log(f"Root: {ROOT}")

    if args.docker and shutil.which("docker"):
        log("\n[docker] Starting via docker compose ...", BOLD)
        run("docker compose up -d --build", cwd=ROOT)
        log("  docker compose up -d done. Health: http://localhost:4433/health", GREEN)
        print_info(DEFAULT_PORT, DEFAULT_PSK)
        return

    check_node()
    if not args.no_build:
        install_and_build()
    else:
        log("\n[skip] --no-build, using existing server/dist", YELLOW)

    psk = args.psk or gen_psk()
    port = args.port or pick_port(DEFAULT_PORT)
    host = args.host

    # quick check dist exists
    if not (SERVER / "dist" / "index.js").exists():
        log(f"  server/dist/index.js missing — build may have failed", RED)
        log(f"  Try: cd server && npm run build", YELLOW)

    ws_url, uri, local_ip = print_info(port, psk, "localhost")

    # write psk to file for convenience (gitignored)
    try:
        (ROOT / ".psk").write_text(psk)
        log(f"  Saved PSK to .psk (gitignored) for reuse", CYAN)
    except: pass

    env = os.environ.copy()
    env["PORT"] = str(port)
    env["HOST"] = host
    env["DEMO_PSK"] = psk
    env["OPS_PATH"] = "/ops"
    env["DECOY_TITLE"] = "Alex Rivera — Photography Portfolio"

    log(f"\n[5/5] Starting server on {host}:{port}  (Ctrl+C to stop)\n", BOLD)
    log(f"  Demo users: demo / student  (PSK above)", YELLOW)
    log(f"  Logs: tail -f server logs, Health: curl http://localhost:{port}/health\n", CYAN)

    if args.open:
        try: webbrowser.open(f"http://localhost:{port}/")
        except: pass

    # start server (blocking)
    cmd = "node dist/index.js"
    log(f"  $ {cmd}  (in {SERVER})\n", CYAN)
    try:
        subprocess.run(cmd, cwd=str(SERVER), env=env, shell=True)
    except KeyboardInterrupt:
        log("\nServer stopped. Re-run: python setup.py  (or ./setup.sh / setup.bat)", YELLOW)
        log(f"  Last PSK was: {psk}  (also in .psk)", CYAN)

if __name__ == "__main__":
    main()
