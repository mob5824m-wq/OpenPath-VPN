import React, { useEffect, useState } from "react";
import { featuresCatalog, defaultFeatures, FeatureMeta, FeaturesConfig } from "../../../core/src/features/features";

const LS_KEY = "openpath:features";

function loadFeatures(): FeaturesConfig {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return { ...defaultFeatures, ...JSON.parse(raw) };
  } catch {}
  return { ...defaultFeatures };
}

export function FeaturesPanel() {
  const [cfg, setCfg] = useState<FeaturesConfig>(() => loadFeatures());

  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(cfg)); } catch {}
  }, [cfg]);

  const toggle = (id: string, value: any) => setCfg((c) => ({ ...c, [id]: value }));

  const netShieldOptions = [
    { v: 0, label: "Off" },
    { v: 1, label: "Block malware" },
    { v: 2, label: "Block malware, ads & trackers" },
  ];

  return (
    <div>
      <h3 style={{ margin: 0 }}>Features <span style={{ color: "#64748b", fontWeight: 400, fontSize: 12 }}>(Proton parity: Secure Core, NetShield, Kill Switch, Split Tunnel, Accelerator, Port Forward, Alternative Routing…)</span></h3>
      <p style={{ fontSize: 12, color: "#64748b", lineHeight: 1.5 }}>All switches work offline-first — like Proton VPN. Secure Core double-hops via Iceland→Switzerland, NetShield filters FortiGate-poisoned DNS, Kill Switch = FortiGate-proof Always-on.</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10, marginTop: 12 }}>
        {featuresCatalog.map((f) => (
          <div key={f.id} style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 12, background: "#fff" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <div style={{ fontSize: 18 }}>{f.icon}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{f.name} <span style={{ fontSize: 10, color: "#94a3b8", fontWeight: 400 }}>· {f.protonEquivalent}</span></div>
                <div style={{ fontSize: 11, color: "#475569", lineHeight: 1.4, marginTop: 2 }}>{f.description}</div>
              </div>
            </div>

            <div style={{ marginTop: 10 }}>
              {f.id === "netShield" && (
                <div style={{ display: "flex", gap: 6 }}>
                  {netShieldOptions.map((o) => (
                    <button key={o.v} onClick={() => toggle(f.id, o.v)} className={`pill ${cfg.netShield === o.v ? "active" : ""}`} style={{ fontSize: 11, background: cfg.netShield === o.v ? "#6366f1" : "#f1f5f9", color: cfg.netShield === o.v ? "#fff" : "#334155", borderColor: cfg.netShield === o.v ? "#6366f1" : "#e2e8f0", cursor: "pointer" }}>{o.label}</button>
                  ))}
                </div>
              )}
              {f.id === "killSwitch" && (
                <select className="select" style={{ fontSize: 12, padding: "6px 8px" }} value={cfg.killSwitch} onChange={(e) => toggle(f.id, e.target.value)}>
                  <option value="off">Off</option>
                  <option value="standard">Standard — block on drop</option>
                  <option value="advanced">Advanced (Always-on — no internet without VPN)</option>
                </select>
              )}
              {f.id === "splitTunnel" && (
                <select className="select" style={{ fontSize: 12, padding: "6px 8px" }} value={cfg.splitTunnel.mode} onChange={(e) => toggle(f.id, { ...cfg.splitTunnel, mode: e.target.value as any })}>
                  <option value="off">Off — all traffic via VPN</option>
                  <option value="exclude">Exclude apps/IPs from VPN (school intranet direct)</option>
                  <option value="include">Include only selected apps/IPs via VPN</option>
                </select>
              )}
              {["secureCore", "portForwarding", "vpnAccelerator", "alternativeRouting", "moderateNAT", "ipv6LeakProtection", "dnsLeakProtection", "alwaysOn", "lanConnections", "stealth"].includes(f.id) && (
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 12 }}>
                  <input type="checkbox" checked={(cfg as any)[f.id]} onChange={(e) => toggle(f.id, e.target.checked)} />
                  <span style={{ color: (cfg as any)[f.id] ? "#0f172a" : "#64748b", fontWeight: 600 }}>{(cfg as any)[f.id] ? "On" : "Off"}</span>
                  {f.id === "secureCore" && cfg.secureCore && <span className="pill" style={{ fontSize: 10, background: "#ecfdf5" }}>🇮🇸 → 🇨🇭</span>}
                </label>
              )}
              {f.id === "customDNS" && (
                <input className="input" placeholder="e.g. 1.1.1.1, 9.9.9.9 (empty = VPN DNS)" style={{ fontSize: 12, padding: "6px 8px" }} value={cfg.customDNS?.join(", ") || ""} onChange={(e) => toggle(f.id, e.target.value ? e.target.value.split(",").map((s) => s.trim()) : null)} />
              )}
              {f.id === "autoConnect" && (
                <select className="select" style={{ fontSize: 12, padding: "6px 8px" }} value={cfg.autoConnect || ""} onChange={(e) => toggle(f.id, e.target.value || null)}>
                  <option value="">Off</option>
                  <option value="fastest">Fastest on boot</option>
                  <option value="last">Last profile</option>
                  <option value="secure-core-ch">Secure Core on boot</option>
                </select>
              )}
            </div>

            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <span style={{ fontSize: 10, color: "#94a3b8" }}>{f.id}</span>
              {f.requiresTier && <span className="pill" style={{ fontSize: 10, background: "#fef3c7" }}>{f.requiresTier} tier</span>}
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 12, background: "#0f172a", color: "#e2e8f0", borderRadius: 12, padding: 12, fontSize: 12, lineHeight: 1.6 }}>
        <div style={{ fontWeight: 700 }}>Active summary</div>
        <div>NetShield: {cfg.netShield === 0 ? "Off" : cfg.netShield === 1 ? "Malware only" : "Malware+ads+trackers"} • Kill Switch: {cfg.killSwitch} • Secure Core: {cfg.secureCore ? "On 🇮🇸→🇨🇭" : "Off"} • Split Tunnel: {cfg.splitTunnel.mode} • Accelerator: {cfg.vpnAccelerator ? "On 🚀" : "Off"} • Alt Routing: {cfg.alternativeRouting ? "On" : "Off"} • FortiGate profile {cfg.stealth ? "GhostPath stealth" : "plain"}</div>
        <div style={{ color: "#94a3b8", marginTop: 4 }}>Stored in localStorage openpath:features + per-profile overrides in openpath:profiles — survives reload, sync via file on native.</div>
      </div>
    </div>
  );
}
