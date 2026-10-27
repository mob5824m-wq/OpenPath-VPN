#!/usr/bin/env python3
"""
OpenPath VPN — SUB HOST setup (worker)
  git clone https://github.com/mob5824m-wq/OpenPath-VPN && cd OpenPath-VPN
  python setup-sub.py --main http://MAIN_IP:4433
  python setup-sub.py --main https://your.duckdns.org --port 4434
Sub-host registers itself with the main host, sends heartbeats.
App first contacts MAIN, gets this sub's wssUrl, then connects here.
No secrets needed — share same PSK as main (default demo key) or pass --psk.
"""
import os, sys, subprocess, platform, secrets, pathlib, shutil, socket, webbrowser

ROOT = pathlib.Path(__file__).parent.resolve()
SERVER = ROOT / "server"
DEFAULT_PORT = 4434
DEFAULT_PSK = "demo-student-key-do-not-use-prod"

BOLD = "\033[1m" if os.name != "nt" else ""
GREEN = "\033[92m" if os.name != "nt" else ""
CYAN = "\033[96m" if os.name != "nt" else ""
YELLOW = "\033[93m" if os.name != "nt" else ""
RED = "\033[91m" if os.name != "nt" else ""
RESET = "\033[0m" if os.name != "nt" else ""
def log(m,c=""): print(f"{c}{m}{RESET}")
def run(cmd,cwd=None,env=None,check=True):
    log(f"  $ {cmd}", CYAN)
    me=os.environ.copy()
    if env: me.update(env)
    r=subprocess.run(cmd, cwd=str(cwd) if cwd else None, env=me, shell=True)
    if check and r.returncode!=0: raise SystemExit(f"Failed: {cmd}")
    return r
def pick_port(pref):
    s=socket.socket()
    try: s.bind(("0.0.0.0",pref)); s.close(); return pref
    except OSError:
        s2=socket.socket(); s2.bind(("0.0.0.0",0)); p=s2.getsockname()[1]; s2.close(); return p

def main():
    import argparse
    ap=argparse.ArgumentParser(description="OpenPath SUB host setup — registers with main")
    ap.add_argument("--main", required=True, help="Main host URL e.g. http://192.168.1.10:4433  or https://main.duckdns.org")
    ap.add_argument("--port", type=int, default=None, help="This sub's port (default 4434)")
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--psk", default=None, help="Must match main's PSK (or demo default)")
    ap.add_argument("--name", default=None, help="Friendly name e.g. Montreal-1")
    ap.add_argument("--region", default="home")
    ap.add_argument("--public-host", default=None, help="Public host/IP clients use to reach this sub (default auto LAN IP)")
    ap.add_argument("--duckdns-domain", default=None, help="DuckDNS domain for this sub (e.g., openpath-sub1, for wss://openpath-sub1.duckdns.org/ops)")
    ap.add_argument("--duckdns-token", default=None, help="DuckDNS token (same for all your domains)")
    ap.add_argument("--docker", action="store_true", help="Use docker compose with Caddy for this sub")
    ap.add_argument("--no-build", action="store_true")
    ap.add_argument("--open", action="store_true")
    args=ap.parse_args()

    log(r"""
  ___                    ____        _   _     __   ____  _   _
                     [SUB HOST — registers with MAIN]
    """, CYAN)
    log(f"Platform: {platform.system()}  Root: {ROOT}", BOLD)
    log(f"Main: {args.main}", YELLOW)
    if not shutil.which("node"):
        log("Node.js not found — install https://nodejs.org", RED); sys.exit(1)
    log("\n[1/5] Checking Node.js ...", BOLD)
    v=subprocess.check_output("node -v", shell=True, text=True).strip()
    log(f"  Node {v}", GREEN)
    if not args.no_build:
        log("\n[2/5] Installing ...", BOLD); run("npm install", cwd=SERVER)
        log("\n[3/5] Building ...", BOLD); r=subprocess.run("npm run build", cwd=str(SERVER), shell=True)
        if r.returncode!=0: run("npx tsc --outDir dist", cwd=SERVER)
    psk=args.psk
    if not psk:
        # try to reuse main's .psk if on same machine, else demo default
        if (ROOT/".psk").exists():
            try: psk=(ROOT/".psk").read_text().strip()
            except: psk=None
        if not psk:
            psk=DEFAULT_PSK
            log(f"\n[4/5] Using demo PSK (shared with main): {psk}", YELLOW)
            log(f"  For private net, pass --psk SAME_AS_MAIN", CYAN)
        else:
            log(f"\n[4/5] Reused PSK from .psk: {psk}", GREEN)
    else:
        log(f"\n[4/5] Using provided PSK: {psk}", GREEN)
    # Docker mode for sub with DuckDNS
    if args.docker:
        # For duckdns, require domain
        dd = args.duckdns_domain
        if not dd:
            log("ERROR: --docker with DuckDNS needs --duckdns-domain openpath-subX", RED); sys.exit(1)
        log(f"\n[docker] Starting sub via docker-compose.sub.duckdns.yml for {dd}.duckdns.org", BOLD)
        env2 = os.environ.copy()
        env2.update({
            "SUB_DUCKDNS_DOMAIN": dd,
            "DUCKDNS_DOMAIN": dd,
            "DUCKDNS_TOKEN": args.duckdns_token or os.environ.get("DUCKDNS_TOKEN",""),
            "MAIN_URL": args.main,
            "DEMO_PSK": psk,
            "HOST_NAME": args.name or f"Sub {dd}",
            "HOST_REGION": args.region,
        })
        run("docker compose --env-file .env.sub -f docker-compose.sub.duckdns.yml up -d --build" if pathlib.Path(".env.sub").exists() else "docker compose -f docker-compose.sub.duckdns.yml up -d --build", cwd=ROOT, env=env2)
        log(f"  Done! Sub running at https://{dd}.duckdns.org/health  → registers to {args.main}", GREEN)
        log(f"  Check: curl https://{dd}.duckdns.org/api/hosts  or  curl {args.main}/api/hosts", CYAN)
        return

    port=args.port or pick_port(DEFAULT_PORT)
    try: lan=socket.gethostbyname(socket.gethostname())
    except: lan="localhost"
    # DuckDNS handling for sub: if --duckdns-domain given, use it as public host
    if args.duckdns_domain:
        public_host = f"{args.duckdns_domain}.duckdns.org"
        wss_for_log = f"wss://{public_host}/ops"
        public_wss = wss_for_log
        log("\n"+"="*62, GREEN)
        log("  SUB HOST (DuckDNS) will register with MAIN", GREEN+BOLD)
        log("="*62, GREEN)
        log(f"  Main:    {args.main}", CYAN)
        log(f"  Sub DuckDNS: https://{public_host}  → {wss_for_log}", CYAN)
        log(f"  App flow: app GET {args.main}/api/hosts → sees wss://{public_host}/ops", CYAN)
        log("="*62+"\n", GREEN)
        env_duck = {
            "PORT":str(port),"HOST":args.host,"DEMO_PSK":psk,"ROLE":"sub",
            "MAIN_URL":args.main,
            "HOST_NAME":args.name or f"Sub {public_host}",
            "HOST_ID":f"sub-{public_host}-{port}",
            "PUBLIC_HOST":public_host,
            "PUBLIC_WSS":public_wss,
            "DUCKDNS_DOMAIN":args.duckdns_domain,
            "SUB_DUCKDNS_DOMAIN":args.duckdns_domain,
            "DUCKDNS_TOKEN":args.duckdns_token or "",
            "HOST_REGION":args.region, "OPS_PATH":"/ops"
        }
        env=os.environ.copy(); env.update(env_duck)
    else:
        public_host=args.public_host or lan
        log("\n"+"="*62, GREEN)
        log("  SUB HOST will register with MAIN", GREEN+BOLD)
        log("="*62, GREEN)
        log(f"  Main:    {args.main}", CYAN)
        log(f"  Sub URL: wss://{public_host}:{port}/ops", CYAN)
        log(f"  API:     http://{public_host}:{port}/health", CYAN)
        log(f"  App flow: app GET {args.main}/api/hosts → sees this sub → connects to wss://{public_host}:{port}/ops", CYAN)
        log(f"  Tip: give this sub its own DuckDNS: --duckdns-domain openpath-sub1 --duckdns-token xxx", CYAN)
        log("="*62+"\n", GREEN)
        env=os.environ.copy()
        env.update({
            "PORT":str(port),"HOST":args.host,"DEMO_PSK":psk,"ROLE":"sub",
            "MAIN_URL":args.main,
            "HOST_NAME":args.name or f"Sub {public_host}:{port}",
            "HOST_ID":f"sub-{public_host}-{port}",
            "PUBLIC_HOST":public_host,
            "PUBLIC_WSS":f"wss://{public_host}:{port}/ops",
            "HOST_REGION":args.region, "OPS_PATH":"/ops"
        })
    log(f"[5/5] Starting SUB on {args.host}:{port} → registering to {args.main} (Ctrl+C to stop)\n", BOLD)
    if args.open:
        try: webbrowser.open(f"http://localhost:{port}/health")
        except: pass
    subprocess.run("node dist/index.js", cwd=str(SERVER), env=env, shell=True)

if __name__=="__main__": main()
