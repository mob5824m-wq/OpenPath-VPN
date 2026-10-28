# Device-wide Stealth VPN: operator setup

Stealth is an **opt-in WireGuard transport**, not the separate `/ops` WebSocket
fetch session. It carries encrypted WireGuard datagrams inside an authenticated
TLS WebSocket to one fixed UDP target. The WireGuard server, peer keys, IP
forwarding, NAT, DNS and IPv4/IPv6 reachability must already work. OpenPath does
not create or provision the WireGuard server. Direct WireGuard remains available.
TLS-over-TCP can be slower or less reliable than UDP. It may be identifiable or
blocked; no censorship-resistance or privacy guarantee is made.

## Deploy the relay safely

1. Use a real domain with a valid, client-trusted TLS certificate and a TLS
   reverse proxy supporting WebSocket upgrades. **Clients require `wss://` and
   verify the certificate and hostname.** There is no plaintext fallback.
2. Run the OpenPath server on the same host as the proxy, bound to loopback, and
   point the relay at a fixed **numeric IP and UDP port** for your WireGuard
   listener. For example, `127.0.0.1:51820`; IPv6 targets use `[::1]:51820`.
   Configure the WireGuard listener and firewall separately. If the backend or
   target is remote, secure that network segment yourself: the relay-to-peer
   UDP hop is not TLS, although WireGuard encrypts the packets.
3. Generate an independent random secret for every relay user, at least 32 bytes
   long. Set `STEALTH_PSKS` to a JSON object mapping user names to secrets.
   These **must not reuse** `OPSK`, `DEMO_PSK` or `STUDENT_PSK`: the legacy
   provisioning API can disclose those credentials. The server rejects reused or
   short relay secrets and the built-in demo key. Deliver relay credentials to
   users securely; do not put them in URLs, logs, a repository or chat.
4. Set the environment and start the built server (example values only):

   ```bash
   export HOST=127.0.0.1 PORT=4433
   export STEALTH_WG_TARGET=127.0.0.1:51820
   export STEALTH_TRUST_PROXY=1
   export STEALTH_RELAY_ONLY=1
   # Set STEALTH_PSKS using your secret manager, e.g. {"alice":"<random secret>"}.
   # It must be valid JSON and must not contain the example placeholder.
   cd server && npm ci && npm run build && npm start
   ```

   `STEALTH_RELAY_ONLY=1` disables the old provisioning, host registry and
   session endpoints; `/health` remains available on the private backend. The
   relay is disabled unless the target and proxy-trust settings are provided.
   No relay is enabled by the repository's demo Compose configuration.
5. Configure the TLS proxy to expose **only** `/stealth-wg`, overwrite the
   forwarded protocol, and never expose port 4433 directly. For example, a
   Caddy site on the same host:

   ```caddyfile
   relay.example.com {
       @relay path /stealth-wg
       handle @relay {
           reverse_proxy 127.0.0.1:4433 {
               header_up X-Forwarded-Proto https
           }
       }
       respond 404
   }
   ```

   `STEALTH_TRUST_PROXY=1` trusts that header. **Anyone who can reach the HTTP
   backend directly can forge it**, so loopback binding/firewall or a private,
   trusted proxy network is mandatory. Disable or redact proxy access logs that
   contain the query string: signed authentication tokens appear in it and are
   replay-sensitive. Time must be synchronized on client and server. The relay
   caps clients, datagram size and send queues, but it is not a substitute for
   deployment-specific rate limiting and monitoring. Behind a reverse proxy,
   repeated authentication failures can temporarily rate-limit that proxy's
   source IP and affect other clients.

The fixed target receives only WireGuard-shaped packets, not a general-purpose
UDP proxy. Stealth accepts WireGuard profile MTUs up to 1900 to stay within
the relay's bounded datagram size; reduce a larger configured MTU before use.
The configured public key and peer profile still control access at
the WireGuard server. Users cannot select arbitrary relay targets.

## Connect the apps

- **Desktop:** import the WireGuard profile, enter the WSS server, relay user and
  PSK in **Settings**, then choose **Stealth WireGuard over TLS relay** on Home.
  The PSK is memory-only. Keep the app open and disconnect before closing it.
  The TLS socket is pinned to the pre-VPN egress interface; only IPv4 relay
  egress is currently supported on desktop. A lost network or failed relay is
  reported separately from the interface state and requires disconnecting and
  reconnecting; there is no direct fallback. On Windows, Stealth uses split
  default routes and **disables WireGuard for Windows' block-untunneled firewall
  and its DNS restriction**. The app asks for explicit acknowledgement. macOS
  and Windows live relay tunnels need validation on the target systems.
- **Android:** import the profile, enter the WSS server and credentials under
  **Settings → Stealth relay**, choose Stealth on Home and grant VPN permission.
  Only the relay socket is protected from VPN recursion; the app is not excluded
  from the VPN. The implementation uses the pinned WireGuard library's service
  internals and fails closed if it cannot access or protect that socket.
  Always-on/lockdown and automatic reconnect are not supported. Android can stop
  the process or revoke VPN permission; test on the actual device.

A connected TLS relay or active interface is **not** proof of a WireGuard
handshake, internet reachability, DNS filtering or a kill switch. The apps do
not protect against all LAN routes, application-specific DNS or leaks outside
the tunnel. Disconnect and verify system routes and actual traffic independently.
If the app crashes, a desktop Stealth WireGuard interface can remain active
with a dead loopback endpoint; inspect and disconnect it rather than assuming it
is working. Local malware/users can interfere with the loopback bridge.

## Tests

`npm --prefix server test` covers auth, fixed target, replay and relay-only
behavior. The native workflow's isolated Linux namespace test exercises a real
kernel WireGuard handshake and traffic over TLS, plus relay failure without
direct fallback; it does not exercise actual DNS/firewall configuration. The
Android emulator workflow exercises direct and Stealth traffic with disposable
keys and a debug-only test CA. The Windows and macOS CI checks exercise local
WireGuard peer handshakes through TLS, not public egress or physical-network
changes. The public test CA and key are not included in release Android builds.
Physical-device and public-network behavior remain unverified.
