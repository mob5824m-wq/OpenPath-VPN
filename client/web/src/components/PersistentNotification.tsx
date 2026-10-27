import React, { useEffect, useState } from "react";
import { NotificationPayload, formatBytes, formatSpeed } from "../../../core/src/notifications/types";
import { demoCanadaPayload } from "../../../core/src/notifications/NotificationManager";

export function PersistentNotification({ payload, onDisconnect }: { payload?: NotificationPayload | null; onDisconnect?: () => void }) {
  const [data, setData] = useState<NotificationPayload | null>(payload || null);

  useEffect(() => {
    const handler = (e: any) => setData(e.detail);
    const hide = () => setData(null);
    window.addEventListener("openpath:notification" as any, handler);
    window.addEventListener("openpath:notification-hide" as any, hide);
    return () => {
      window.removeEventListener("openpath:notification" as any, handler);
      window.removeEventListener("openpath:notification-hide" as any, hide);
    };
  }, []);

  const p = payload ?? data;
  // demo fallback like screenshot if nothing connected (show preview)
  const display: NotificationPayload = p || demoCanadaPayload();

  const isConnected = display.status === "connected";
  const down = `↓ ${formatBytes(display.stats.rxBytes)} | ${formatSpeed(display.stats.rxSpeedBps)}`;
  const up = `↑ ${formatBytes(display.stats.txBytes)} | ${formatSpeed(display.stats.txSpeedBps)}`;

  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        background: isConnected ? "#fff" : "#fef3c7",
        borderBottom: `1px solid ${isConnected ? "#e2e8f0" : "#f59e0b"}`,
        boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
        padding: "10px 14px",
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
    >
      {/* Logo shield */}
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: "50%",
          background: "#f0fdf4",
          border: "1px solid #dcfce7",
          display: "grid",
          placeItems: "center",
          flexShrink: 0,
        }}
      >
        <img src="/assets/logo.png" alt="OpenPath" style={{ width: 22, height: 22, objectFit: "contain" }}
          onError={(e) => ((e.currentTarget.style.display = "none"), ((e.currentTarget.nextSibling as HTMLElement).style.display = "block"))}
        />
        <span style={{ display: "none", fontSize: 18 }}>🛡️</span>
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 800, fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
          <span>{display.country.flag} Connected to {display.country.name}</span>
          {display.secureCoreExit && <span style={{ fontSize: 11, background: "#ecfdf5", border: "1px solid #a7f3d0", padding: "2px 6px", borderRadius: 999 }}>via {display.secureCoreExit.flag} {display.secureCoreExit.name}</span>}
          <span style={{ marginLeft: 6, width: 8, height: 8, background: isConnected ? "#10b981" : "#f59e0b", borderRadius: 999, display: "inline-block", boxShadow: isConnected ? "0 0 0 4px #dcfce7" : "none" }} />
          <span style={{ fontSize: 11, color: "#64748b", fontWeight: 600, marginLeft: 4 }}>{isConnected ? "Always present • Ongoing" : display.status.toUpperCase()}</span>
        </div>
        <div style={{ fontSize: 12, color: "#334155", marginTop: 2, fontFamily: "JetBrains Mono, monospace", display: "flex", gap: 10, flexWrap: "wrap" }}>
          <span>{down}</span>
          <span>{up}</span>
          <span style={{ color: "#94a3b8" }}>{display.ip || "10.89.0.2 → 185.159.157.12"} • {display.protocol || "GhostPath stealth"}{display.stats.durationSec ? ` • ${Math.floor(display.stats.durationSec / 60)}m` : ""}</span>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <a href="#" onClick={(e) => { e.preventDefault(); onDisconnect?.(); window.dispatchEvent(new CustomEvent("openpath:disconnect")); }} style={{ color: "#0ea5e9", fontSize: 13, fontWeight: 700, textDecoration: "none" }}>Disconnect</a>
        <div style={{ width: 1, height: 20, background: "#e2e8f0" }} />
        <button onClick={() => window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" })} style={{ border: 0, background: "transparent", cursor: "pointer", fontSize: 16, color: "#64748b" }}>⌃</button>
      </div>
    </div>
  );
}

// Demo static version matching screenshot exactly (for docs)
export function ProtonStylePreview() {
  return <PersistentNotification payload={demoCanadaPayload()} onDisconnect={() => alert("Disconnect — native notification action would close TUN")} />;
}
