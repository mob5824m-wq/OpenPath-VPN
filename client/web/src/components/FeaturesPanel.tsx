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

const categories: { id: string; label: string; icon: string }[] = [
  { id: "privacy", label: "Privacy", icon: "🕵️" },
  { id: "security", label: "Security", icon: "🔒" },
  { id: "freedom", label: "Freedom / Anti-censorship", icon: "🌍" },
  { id: "performance", label: "Performance", icon: "🚀" },
  { id: "usability", label: "Usability", icon: "⚙️" },
  { id: "platform", label: "Platform & Support", icon: "🖥️" },
];

export function FeaturesPanel() {
  const [cfg, setCfg] = useState<FeaturesConfig>(() => loadFeatures());
  const [filter, setFilter] = useState<string>("all");
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(cfg)); } catch {}
  }, [cfg]);

  const toggle = (id: string, value: any) => setCfg((c) => ({ ...c, [id]: value }));

  const netShieldOptions = [
    { v: 0, label: "Off" },
    { v: 1, label: "Block malware" },
    { v: 2, label: "Block malware, ads & trackers" },
  ];

  const filtered = filter === "all" ? featuresCatalog : featuresCatalog.filter(f => f.category === filter);

  return (
    <div style={{ border: "1px solid #e2e8f0", borderRadius: 16, background: "#fff", overflow: "hidden" }}>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", cursor: "pointer", background: "#f8fafc", borderBottom: expanded ? "1px solid #e2e8f0" : "none" }}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: 15 }}>All Features <span style={{ color: "#64748b", fontWeight: 400, fontSize: 11 }}>({featuresCatalog.length} — click to toggle)</span></h3>
          <p style={{ margin: "4px 0 0", fontSize: 11, color: "#64748b" }}>Everything OpenPath supports: Secure Core, NetShield, Tor, Smart Protocol, VPN Accelerator, Split Tunnel, etc. Toggleable features saved locally.</p>
        </div>
        <span style={{ fontSize: 12, background: "#e0f2fe", padding: "4px 10px", borderRadius: 999 }}>{expanded ? "▼ Collapse" : "▶ Expand"}</span>
      </div>

      {expanded && (
        <div style={{ padding: 14 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
            <button onClick={() => setFilter("all")} style={{ padding: "6px 10px", borderRadius: 999, border: filter === "all" ? "1px solid #0ea5e9" : "1px solid #e2e8f0", background: filter === "all" ? "#0ea5e9" : "#fff", color: filter === "all" ? "#fff" : "#334155", fontSize: 11, cursor: "pointer" }}>All ({featuresCatalog.length})</button>
            {categories.map(c => (
              <button key={c.id} onClick={() => setFilter(c.id)} style={{ padding: "6px 10px", borderRadius: 999, border: filter === c.id ? "1px solid #0ea5e9" : "1px solid #e2e8f0", background: filter === c.id ? "#0ea5e9" : "#fff", color: filter === c.id ? "#fff" : "#334155", fontSize: 11, cursor: "pointer" }}>{c.icon} {c.label}</button>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
            {filtered.map((f) => (
              <div key={f.id} style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 12, background: f.infoOnly ? "#f8fafc" : "#fff", opacity: f.infoOnly ? 0.95 : 1 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <div style={{ fontSize: 18 }}>{f.icon}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 12 }}>{f.name} <span style={{ fontSize: 9, color: "#94a3b8", fontWeight: 400 }}>· {f.equivalent}</span> {f.infoOnly && <span style={{ fontSize: 9, background: "#ecfdf5", border: "1px solid #a7f3d0", padding: "1px 5px", borderRadius: 999, color: "#059669" }}>always-on</span>}</div>
                    <div style={{ fontSize: 11, color: "#475569", lineHeight: 1.4, marginTop: 2 }}>{f.description}</div>
                  </div>
                </div>

                <div style={{ marginTop: 10 }}>
                  {f.id === "netShield" && (
                    <div style={{ display: "flex", gap: 6 }}>
                      {netShieldOptions.map((o) => (
                        <button key={o.v} onClick={() => toggle(f.id, o.v)} style={{ fontSize: 10, padding: "4px 8px", borderRadius: 999, border: "1px solid", borderColor: cfg.netShield === o.v ? "#6366f1" : "#e2e8f0", background: cfg.netShield === o.v ? "#6366f1" : "#f1f5f9", color: cfg.netShield === o.v ? "#fff" : "#334155", cursor: "pointer" }}>{o.label}</button>
                      ))}
                    </div>
                  )}
                  {f.id === "killSwitch" && (
                    <select style={{ fontSize: 11, padding: "6px 8px", borderRadius: 8, border: "1px solid #e2e8f0", width: "100%" }} value={cfg.killSwitch} onChange={(e) => toggle(f.id, e.target.value)}>
                      <option value="off">Off</option>
                      <option value="standard">Standard — block on drop</option>
                      <option value="advanced">Advanced (Always-on — no internet without VPN)</option>
                    </select>
                  )}
                  {f.id === "splitTunnel" && (
                    <select style={{ fontSize: 11, padding: "6px 8px", borderRadius: 8, border: "1px solid #e2e8f0", width: "100%" }} value={cfg.splitTunnel.mode} onChange={(e) => toggle(f.id, { ...cfg.splitTunnel, mode: e.target.value as any })}>
                      <option value="off">Off — all traffic via VPN</option>
                      <option value="exclude">Exclude apps/IPs from VPN</option>
                      <option value="include">Include only selected apps/IPs</option>
                    </select>
                  )}
                  {["secureCore","portForwarding","vpnAccelerator","alternativeRouting","moderateNAT","ipv6LeakProtection","dnsLeakProtection","alwaysOn","lanConnections","stealth","torOverVPN","smartProtocol","twoFactor","browserExtension","p2p"].includes(f.id) && (
                    <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 11 }}>
                      <input type="checkbox" checked={(cfg as any)[f.id]} onChange={(e) => toggle(f.id, e.target.checked)} />
                      <span style={{ color: (cfg as any)[f.id] ? "#0f172a" : "#64748b", fontWeight: 600 }}>{(cfg as any)[f.id] ? "On" : "Off"}</span>
                      {f.id === "secureCore" && cfg.secureCore && <span style={{ fontSize: 9, background: "#ecfdf5", padding: "1px 6px", borderRadius: 999 }}>🇮🇸 → 🇨🇭</span>}
                      {f.id === "torOverVPN" && cfg.torOverVPN && <span style={{ fontSize: 9, background: "#fef3c7", padding: "1px 6px", borderRadius: 999 }}>🧅 via SOCKS 1080</span>}
                    </label>
                  )}
                  {f.id === "customDNS" && (
                    <input style={{ fontSize: 11, padding: "6px 8px", borderRadius: 8, border: "1px solid #e2e8f0", width: "100%" }} placeholder="e.g. 1.1.1.1, 9.9.9.9 (empty = VPN DNS)" value={cfg.customDNS?.join(", ") || ""} onChange={(e) => toggle(f.id, e.target.value ? e.target.value.split(",").map((s) => s.trim()) : null)} />
                  )}
                  {f.id === "autoConnect" && (
                    <select style={{ fontSize: 11, padding: "6px 8px", borderRadius: 8, border: "1px solid #e2e8f0", width: "100%" }} value={cfg.autoConnect || ""} onChange={(e) => toggle(f.id, e.target.value || null)}>
                      <option value="">Off</option>
                      <option value="fastest">Fastest on boot</option>
                      <option value="last">Last profile</option>
                      <option value="secure-core-ch">Secure Core on boot</option>
                    </select>
                  )}
                  {f.infoOnly && (
                    <div style={{ fontSize: 10, color: "#059669", background: "#ecfdf5", padding: "4px 8px", borderRadius: 8, border: "1px solid #a7f3d0" }}>✓ Active — {f.equivalent}</div>
                  )}
                </div>

                <div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 9, color: "#94a3b8" }}>{f.id} · {f.category}</span>
                  {f.requiresTier && <span style={{ fontSize: 9, background: "#fef3c7", padding: "1px 5px", borderRadius: 999 }}>{f.requiresTier}</span>}
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 12, background: "#0f172a", color: "#e2e8f0", borderRadius: 12, padding: 12, fontSize: 11, lineHeight: 1.6 }}>
            <div style={{ fontWeight: 700 }}>Active summary — {cfg.netShield === 0 ? "No NetShield" : cfg.netShield === 1 ? "Malware block" : "Full Ad-block"} • Kill Switch: {cfg.killSwitch} • Secure Core: {cfg.secureCore ? "On 🇮🇸→🇨🇭" : "Off"} • Tor: {cfg.torOverVPN ? "On 🧅" : "Off"} • Split: {cfg.splitTunnel.mode} • Accelerator: {cfg.vpnAccelerator ? "On 🚀" : "Off"} • SmartProto: {cfg.smartProtocol ? "Auto" : "Off"} • AltRouting: {cfg.alternativeRouting ? "On" : "Off"} • FortiGate: {cfg.stealth ? "GhostPath" : "plain"} • 2FA: {cfg.twoFactor ? "On" : "Off"}</div>
            <div style={{ color: "#94a3b8", marginTop: 4 }}>Stored in localStorage <code>openpath:features</code> + per-profile. Export/import in Profiles panel. Enable or disable exactly what this app provides.</div>
          </div>
        </div>
      )}
    </div>
  );
}
