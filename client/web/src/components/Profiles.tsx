import React, { useState } from "react";
import { Profile, defaultProfiles, loadProfiles, saveProfiles, createCustomProfile, getQuickConnects } from "../../../core/src/profiles/profiles";
import { Country } from "../../../core/src/notifications/types";

const COUNTRIES: Country[] = [
  { code: "CA", name: "Canada", flag: "🇨🇦", city: "Toronto", serverName: "CA#22" },
  { code: "US", name: "United States", flag: "🇺🇸", city: "New York", serverName: "US-NY#08" },
  { code: "GB", name: "United Kingdom", flag: "🇬🇧", city: "London", serverName: "GB#03" },
  { code: "CH", name: "Switzerland", flag: "🇨🇭", city: "Zurich", serverName: "CH#12" },
  { code: "NL", name: "Netherlands", flag: "🇳🇱", city: "Amsterdam", serverName: "NL#05" },
  { code: "DE", name: "Germany", flag: "🇩🇪", city: "Berlin", serverName: "DE#07" },
  { code: "JP", name: "Japan", flag: "🇯🇵", city: "Tokyo", serverName: "JP#09" },
  { code: "IS", name: "Iceland", flag: "🇮🇸", city: "Reykjavik", serverName: "IS#01" },
];

export function ProfilesPanel({ onSelect }: { onSelect?: (p: Profile) => void }) {
  const [profiles, setProfiles] = useState<Profile[]>(() => loadProfiles());
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCountry, setNewCountry] = useState<Country>(COUNTRIES[0]);
  const [newIcon, setNewIcon] = useState("⭐");
  const [newColor, setNewColor] = useState("#6366f1");
  const [editingSecureCore, setEditingSecureCore] = useState(false);

  const add = () => {
    if (!newName.trim()) return;
    const p = createCustomProfile({ name: newName, country: newCountry, color: newColor, icon: newIcon, secureCore: editingSecureCore, stealthProfile: "fortinet", tags: ["custom"] });
    const next = [...profiles, p];
    setProfiles(next);
    saveProfiles(next);
    setShowCreate(false);
    setNewName("");
  };

  const del = (id: string) => {
    const next = profiles.filter((p) => p.id !== id);
    setProfiles(next);
    saveProfiles(next);
  };

  const quick = getQuickConnects(profiles);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0 }}>Profiles <span style={{ color: "#64748b", fontWeight: 400, fontSize: 13 }}>(Proton-like: Quick Connect, Streaming, P2P, Tor, Secure Core)</span></h3>
        <button className="btn btn-primary" style={{ padding: "8px 12px", fontSize: 12 }} onClick={() => setShowCreate(!showCreate)}>{showCreate ? "Cancel" : "+ Create Profile"}</button>
      </div>

      {showCreate && (
        <div style={{ marginTop: 12, border: "1px solid #e2e8f0", borderRadius: 12, padding: 12, background: "#f8fafc" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 120px", gap: 8 }}>
            <input className="input" placeholder="Profile name (e.g. School Fortnite)" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <select className="select" value={newCountry.code} onChange={(e) => setNewCountry(COUNTRIES.find((c) => c.code === e.target.value)!)}> {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.flag} {c.name}</option>)} </select>
            <input className="input" type="color" value={newColor} onChange={(e) => setNewColor(e.target.value)} title="Color" />
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "#64748b" }}>Icon</span>
            {["⭐", "🏫", "🎬", "⬇️", "🛡️", "🧅", "🌐", "🎮"].map((ic) => (
              <button key={ic} onClick={() => setNewIcon(ic)} style={{ border: newIcon === ic ? "2px solid #6366f1" : "1px solid #e2e8f0", borderRadius: 8, padding: 6, background: "#fff", cursor: "pointer" }}>{ic}</button>
            ))}
            <label style={{ marginLeft: 8, display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}><input type="checkbox" checked={editingSecureCore} onChange={(e) => setEditingSecureCore(e.target.checked)} />Secure Core</label>
            <button className="btn btn-primary" style={{ marginLeft: "auto", padding: "8px 12px" }} onClick={add}>Create</button>
          </div>
        </div>
      )}

      <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
        <span className="pill" style={{ background: "#f1f5f9" }}>Quick Connect →</span>
        {quick.map((p) => (
          <span key={p.id} className="pill" style={{ background: p.color, color: "#fff", cursor: "pointer" }} onClick={() => onSelect?.(p)}>{p.icon} {p.name}</span>
        ))}
      </div>

      <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 10 }}>
        {profiles.map((p) => (
          <div key={p.id} style={{ border: `1.5px solid ${p.color}30`, borderLeft: `6px solid ${p.color}`, borderRadius: 12, padding: 12, background: "#fff", position: "relative" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <div style={{ width: 32, height: 32, borderRadius: 999, background: `${p.color}15`, border: `1px solid ${p.color}30`, display: "grid", placeItems: "center" }}>{p.icon}</div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{p.name} {p.isSystem && <span style={{ fontSize: 10, background: "#f1f5f9", padding: "2px 6px", borderRadius: 999 }}>system</span>}</div>
                  <div style={{ fontSize: 11, color: "#64748b" }}>{p.country.flag} {p.country.name} {p.city ? `• ${p.city}` : ""} • {p.country.serverName || p.serverId || "Auto"}</div>
                </div>
              </div>
              {!p.isSystem && <button onClick={() => del(p.id)} style={{ border: 0, background: "transparent", color: "#ef4444", cursor: "pointer", fontSize: 12 }}>✕</button>}
            </div>
            <div style={{ fontSize: 11, color: "#475569", marginTop: 6, lineHeight: 1.5 }}>{p.description}</div>
            <div style={{ display: "flex", gap: 4, marginTop: 8, flexWrap: "wrap" }}>
              {p.secureCore && <span className="pill" style={{ fontSize: 10, background: "#ecfdf5", borderColor: "#a7f3d0" }}>🛡️ Secure Core {p.secureCoreEntry ? `via ${p.secureCoreEntry.flag}` : ""}</span>}
              {p.tags.map((t) => <span key={t} className="pill" style={{ fontSize: 10 }}>{t}</span>)}
              <span className="pill" style={{ fontSize: 10, background: "#f8fafc" }}>{p.protocol}</span>
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
              <button className="btn btn-primary" style={{ flex: 1, padding: "6px 10px", fontSize: 12 }} onClick={() => onSelect?.(p)}>Connect</button>
              <button className="btn btn-ghost" style={{ padding: "6px 10px", fontSize: 11 }} onClick={() => navigator.clipboard.writeText(`openpath://${p.country.serverName || p.id}`)}>Share</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
