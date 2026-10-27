#!/usr/bin/env python3
"""
OpenPath VPN — MAIN HOST setup (directory)
  git clone https://github.com/mob5824m-wq/OpenPath-VPN && cd OpenPath-VPN
  python setup-main.py
The main host is the directory: app connects here first, gets list of sub-hosts.
- Listens on 4433 (or --port)
- Exposes GET /api/hosts for apps
- Sub-hosts register via POST /api/hosts/register
No secrets needed.
"""
import os, sys, subprocess, platform, secrets, pathlib, shutil, socket, webbrowser

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
def log(msg, color=""): print(f"{color}{msg}{RESET}")
def run(cmd, cwd=None, env=None, check=True):
    log(f"  $ {cmd}", CYAN)
    m=os.environ.copy()
    if env: m.update(env)
    r=subprocess.run(cmd, cwd=str(cwd) if cwd else None, env=m, shell=True)
    if check and r.returncode!=0: raise SystemExit(f"Command failed: {cmd}")
    return r
def check_node():
    log("\n[1/5] Checking Node.js + npm ...", BOLD)
    if not shutil.which("node") or not shutil.which("npm"):
        log("  Node.js not found. Install from https://nodejs.org (v18+)", RED); sys.exit(1)
    v=subprocess.check_output("node -v", shell=True, text=True).strip()
    log(f"  Found Node {v} + npm {subprocess.check_output('npm -v', shell=True, text=True).strip()}", GREEN)
def pick_port(pref):
    s=socket.socket()
    try: s.bind(("0.0.0.0", pref)); s.close(); return pref
    except OSError:
        s2=socket.socket(); s2.bind(("0.0.0.0",0)); p=s2.getsockname()[1]; s2.close(); return p

def main():
    import argparse
    ap=argparse.ArgumentParser(description="OpenPath MAIN host setup — no secrets")
    ap.add_argument("--port", type=int, default=None)
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--psk", default=None)
    ap.add_argument("--name", default=None, help="Host name (default OpenPath Main)")
    ap.add_argument("--region", default="us-east")
    ap.add_argument("--no-build", action="store_true")
    ap.add_argument("--docker", action="store_true")
    ap.add_argument("--open", action="store_true")
    args=ap.parse_args()

    log(r"""
  ___                    ____        _   _     __   ____  _   _
 / _ \  _ __    ___  _  |  _ \  __ _| |_| |__  \ \ / / _ \| \ | |
                     [MAIN HOST — directory for sub-hosts]
    """, CYAN)
    log(f"Platform: {platform.system()} Python {platform.python_version()}  Root: {ROOT}", BOLD)
    if args.docker and shutil.which("docker"):
        log("\n[docker] docker compose up -d --build", BOLD); run("docker compose up -d --build", cwd=ROOT); return
    check_node()
    if not args.no_build:
        log("\n[2/5] Installing deps ...", BOLD); run("npm install", cwd=SERVER)
        log("\n[3/5] Building ...", BOLD); r=subprocess.run("npm run build", cwd=str(SERVER), shell=True)
        if r.returncode!=0: run("npx tsc --outDir dist", cwd=SERVER)
    psk=args.psk or secrets.token_urlsafe(32)
    log(f"\n[4/5] PSK: {psk} (share with apps + subs)", GREEN)
    try: (ROOT/".psk").write_text(psk)
    except: pass
    port=args.port or pick_port(DEFAULT_PORT)
    host=args.host
    try: local_ip=socket.gethostbyname(socket.gethostname())
    except: local_ip="localhost"
    log("\n"+"="*62, GREEN)
    log("  MAIN HOST ready — apps fetch sub-host list here", GREEN+BOLD)
    log("="*62, GREEN)
    log(f"  Health:  http://localhost:{port}/health", CYAN)
    log(f"  Hosts:   http://localhost:{port}/api/hosts  ← app calls this", CYAN)
    log(f"  LAN hosts URL: http://{local_ip}:{port}/api/hosts", CYAN)
    log(f"  PSK: {psk}", BOLD)
    log(f"  Sub-hosts should run: python setup-sub.py --main http://{local_ip}:{port} --port 4434", YELLOW)
    log(f"  App flow: GET /api/hosts → pick sub wssUrl → connect", CYAN)
    log("="*62+"\n", GREEN)
    env=os.environ.copy()
    env.update({"PORT":str(port),"HOST":host,"DEMO_PSK":psk,"ROLE":"main","HOST_NAME":args.name or "OpenPath Main","HOST_ID":f"main-{host}-{port}","HOST_REGION":args.region,"OPS_PATH":"/ops"})
    log(f"[5/5] Starting MAIN on {host}:{port} (Ctrl+C to stop)\n", BOLD)
    if args.open:
        try: webbrowser.open(f"http://localhost:{port}/api/hosts")
        except: pass
    subprocess.run("node dist/index.js", cwd=str(SERVER), env=env, shell=True)

if __name__=="__main__": main()
