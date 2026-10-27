import React, { useEffect, useRef, useState } from 'react'
import { PersistentNotification } from './components/PersistentNotification'

async function buildAuthTokenAsync(psk: string, path='/ops'): Promise<string> {
  const ts = Date.now().toString();
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(12))).map(b=>b.toString(16).padStart(2,'0')).join('');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(psk), { name:'HMAC', hash:'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${ts}.${nonce}.${path}`));
  const hex = [...new Uint8Array(sig)].map(b=>b.toString(16).padStart(2,'0')).join('');
  return `${ts}.${nonce}.${hex}`;
}

type HostEntry = { id:string; name:string; host:string; port:number; wssUrl:string; duckdnsUrl?:string; region:string; country:string; flag:string; load:number; online:boolean; latencyMs?:number }
type ProfileRow = { id:string; name:string; subtitle:string; icon:string; color:string; flag?:string; fast?:boolean; connected?:boolean }

const PROFILES: ProfileRow[] = [
  { id:'streaming-us', name:'Streaming US', subtitle:'United States', icon:'▶️', color:'#7c6cff', flag:'🇺🇸' },
  { id:'gaming', name:'Gaming', subtitle:'Fastest country', icon:'🎮', color:'#1a1a24', fast:true },
  { id:'anti-censorship', name:'Anti-censorship', subtitle:'Fastest country (excluding my country)', icon:'🕶️', color:'#1a1a24', fast:true },
  { id:'school', name:'School', subtitle:'Canada', icon:'💼', color:'#1a1a24', flag:'🇨🇦', connected:true },
  { id:'home', name:'Home', subtitle:'Fastest country', icon:'⚡', color:'#1a1a24', fast:true },
]

const COUNTRIES = [
  { code:'CA', name:'Canada', flag:'🇨🇦', cities:['Toronto','Montreal','Vancouver'], load:32, p2p:true, tor:true },
  { code:'US', name:'United States', flag:'🇺🇸', cities:['New York','Los Angeles','Chicago'], load:41 },
  { code:'GB', name:'United Kingdom', flag:'🇬🇧', cities:['London'], load:28 },
  { code:'CH', name:'Switzerland', flag:'🇨🇭', cities:['Zurich'], load:22 },
  { code:'DE', name:'Germany', flag:'🇩🇪', cities:['Frankfurt','Berlin'], load:35 },
  { code:'NL', name:'Netherlands', flag:'🇳🇱', cities:['Amsterdam'], load:30 },
  { code:'JP', name:'Japan', flag:'🇯🇵', cities:['Tokyo'], load:44 },
  { code:'IS', name:'Iceland', flag:'🇮🇸', cities:['Reykjavik'], load:18 },
  { code:'AU', name:'Australia', flag:'🇦🇺', cities:['Sydney'], load:38 },
  { code:'FR', name:'France', flag:'🇫🇷', cities:['Paris'], load:29 },
]

export default function App(){
  const [serverUrl, setServerUrl] = useState(()=>{
    if (typeof location !== 'undefined' && location.protocol === 'https:') return `wss://${location.host}/ops`;
    if (typeof location !== 'undefined') return `ws://${location.hostname}:4433/ops`;
    return `ws://localhost:4433/ops`;
  });
  const [psk] = useState('demo-student-key-do-not-use-prod');
  const [user] = useState('demo');
  const [vpnMode, setVpnMode] = useState<'stealth'|'fast'>(()=> {
    try{ return (localStorage.getItem('openpath:mode') as any) || 'stealth'} catch{ return 'stealth'}
  });
  const [tab, setTab] = useState<'home'|'countries'|'profiles'|'settings'>('home');
  const [connected, setConnected] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState<ProfileRow>(PROFILES[3]); // School default as screenshot
  const [hosts, setHosts] = useState<{main:any; hosts:HostEntry[]; online:number; total:number}|null>(null);
  const [clientIp, setClientIp] = useState<string>('');
  const [clientIpLoading, setClientIpLoading] = useState(true);
  const [logs, setLogs] = useState<string[]>(()=>[`[${new Date().toLocaleTimeString()}] OpenPath — GhostPath ready.`]);
  const [rtt, setRtt] = useState(0);
  const [rx, setRx] = useState(0);
  const [tx, setTx] = useState(0);
  const wsRef = useRef<WebSocket|null>(null);
  const rxRef = useRef(0), txRef = useRef(0);
  const [ads, setAds] = useState(0);
  const [trackers, setTrackers] = useState(0);
  const [saved, setSaved] = useState(0);

  useEffect(()=>{ try{ localStorage.setItem('openpath:mode', vpnMode)}catch{}},[vpnMode]);
  const log=(m:string)=> setLogs(l=> [...l.slice(-60), `[${new Date().toLocaleTimeString()}] ${m}`]);

  // fetch client IP once — don't constantly refresh
  useEffect(()=>{
    let cancelled=false;
    async function fetchIp(){
      try{
        // try server endpoint first (no CORS), fallback to ipify
        const r = await fetch('/api/ip');
        if(r.ok){ const d=await r.json(); if(!cancelled) setClientIp(d.ip); setClientIpLoading(false); return; }
      }catch{}
      try{
        const r2 = await fetch('https://api.ipify.org?format=json');
        if(r2.ok){ const d=await r2.json(); if(!cancelled) setClientIp(d.ip); }
      }catch{
        if(!cancelled) setClientIp('203.0.113.42');
      } finally{ if(!cancelled) setClientIpLoading(false); }
    }
    fetchIp();
    return ()=>{ cancelled=true }
  }, []);

  // fetch hosts once on mount only — not constantly refreshing
  const fetchHosts = async()=>{
    try{
      const res = await fetch('/api/hosts');
      if(res.ok){ const d=await res.json(); setHosts(d); log(`Fetched ${d.online}/${d.total} hosts via proxy`); return; }
    }catch(e:any){ log(`Hosts fetch failed: ${e.message}`)}
  };
  useEffect(()=>{ fetchHosts(); }, []);

  const connect = async (override?:string, profile?:ProfileRow)=>{
    const target = override || serverUrl;
    if(profile) setSelectedProfile(profile);
    if(wsRef.current?.readyState===1){ wsRef.current.close(); return; }
    const pathForAuth = vpnMode==='fast' ? '/fast' : '/ops';
    let token:string;
    try{ token = await buildAuthTokenAsync(psk, pathForAuth)}catch(e:any){ log(`HMAC fail: ${e.message}`); return; }
    const u = new URL(target);
    if(vpnMode==='fast' && u.pathname==='/ops') u.pathname='/fast';
    if(vpnMode==='stealth' && u.pathname==='/fast') u.pathname='/ops';
    u.searchParams.set('auth', token); u.searchParams.set('user', user);
    if(vpnMode==='fast') u.searchParams.set('mode','fast');
    const wsUrl=u.toString();
    log(`Connecting → ${u.host}${u.pathname} ${vpnMode==='fast'?'(⚡ Turbo)':'(Stealth)'}`);
    try{
      const ws=new WebSocket(wsUrl); (ws as any).binaryType='arraybuffer'; wsRef.current=ws;
      ws.onopen=()=>{
        const prof = profile || selectedProfile;
        log(`✓ Tunnel UP to ${u.host} as ${prof.name}`);
        setConnected(true); setRtt(22+Math.floor(Math.random()*15));
        // fake NetShield counters start ticking when connected
        setAds(a=>a+ Math.floor(Math.random()*3)); setTrackers(t=>t+ Math.floor(Math.random()*5)); setSaved(s=>s+ Math.floor(Math.random()*200));
        ws.send(JSON.stringify({op:'ping', t:Date.now()}));
        const payload={ status:"connected", profileName: prof.name, country:{code:"CA", name: prof.subtitle==="Canada"? "Canada": prof.name, flag: prof.flag||"🇨🇦", city: prof.subtitle==="Canada"?"Toronto":prof.subtitle}, stats:{rxBytes:0, txBytes:0, rxSpeedBps:1500, txSpeedBps:1200, durationSec:12, connectedSince:Date.now()}, ip: u.hostname, protocol: vpnMode==='fast'?'TurboDirect':'GhostPath', showSpeeds:true, showVolume:true };
        // @ts-ignore
        window.dispatchEvent(new CustomEvent("openpath:notification",{detail:payload}));
      };
      ws.onmessage=(ev)=>{
        const len = typeof ev.data==='string'? ev.data.length : (ev.data as ArrayBuffer).byteLength; rxRef.current+=len;
        try{
          const txt= typeof ev.data==='string'? ev.data: new TextDecoder().decode(ev.data as ArrayBuffer);
          const msg=JSON.parse(txt);
          if(msg.t==='hello') log(`Server hello ${msg.id.slice(0,6)}…`);
          if(msg.op==='pong') setRtt(Date.now()-(msg.t||Date.now()));
        }catch{}
        setRx(rxRef.current); setTx(txRef.current);
      };
      ws.onclose=(e)=>{ log(`Tunnel closed (${e.code})`); setConnected(false); wsRef.current=null; window.dispatchEvent(new CustomEvent("openpath:notification-hide")); };
      ws.onerror=()=>{ log(`Transport error — check PSK`); };
    }catch(e:any){ log(`Connect error: ${e.message}`)}
  };
  const disconnect=()=> wsRef.current?.close();

  // --- Render helpers ---
  const TopChrome = () => (
    <div style={{ height:28, background:'#0a0a0f', display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 12px', borderBottom:'1px solid #1a1a24', flexShrink:0 }}>
      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
        <span style={{ color:'#fff', cursor:'pointer', padding:4 }} onClick={()=> window.history.back()}>‹</span>
      </div>
      <div style={{ display:'flex', alignItems:'center', gap:10, color:'#6b7280', fontSize:12 }}>
        <span style={{ width:14, height:2, background:'#6b7280', borderRadius:1, display:'inline-block' }} />
        <span style={{ width:12, height:12, border:'1px solid #6b7280', borderRadius:2, display:'inline-block' }} />
        <span style={{ fontSize:14, cursor:'pointer' }} onClick={()=>window.close()}>✕</span>
      </div>
    </div>
  );

  const WorldMap = ({ highlighted }:{ highlighted?: boolean }) => (
    <div style={{ position:'relative', height:220, overflow:'hidden', background:'#08080c' }}>
      <svg viewBox="0 0 1000 500" style={{ width:'100%', height:'100%', opacity: highlighted?1:0.55 }}>
        {/* simplified continents — low-poly for Proton-like look */}
        {/* North America */}
        <path d="M 40 80 L 90 60 L 140 80 L 180 120 L 220 140 L 260 130 L 240 180 L 200 210 L 160 200 L 120 160 L 60 140 Z" fill="#3a3850" stroke="#4a4860" strokeWidth="1"/>
        <path d="M 60 220 L 90 200 L 130 210 L 150 250 L 110 280 L 60 260 Z" fill="#3a3850" stroke="#4a4860" strokeWidth="1"/>
        {/* South America */}
        <path d="M 220 300 L 260 290 L 290 320 L 280 380 L 240 420 L 210 360 Z" fill="#3a3850" stroke="#4a4860" strokeWidth="1"/>
        {/* Europe */}
        <path d="M 460 100 L 520 90 L 560 110 L 540 150 L 500 160 L 460 130 Z" fill="#3a3850" stroke="#4a4860" strokeWidth="1"/>
        {/* Africa */}
        <path d="M 480 180 L 540 170 L 570 220 L 550 300 L 510 320 L 470 260 L 460 200 Z" fill="#3a3850" stroke="#4a4860" strokeWidth="1"/>
        {/* Asia */}
        <path d="M 580 80 L 750 60 L 850 90 L 880 150 L 820 180 L 760 160 L 650 140 L 580 110 Z" fill="#3a3850" stroke="#4a4860" strokeWidth="1"/>
        <path d="M 600 170 L 750 180 L 820 220 L 780 280 L 660 260 L 600 200 Z" fill="#3a3850" stroke="#4a4860" strokeWidth="1"/>
        {/* Australia */}
        <path d="M 770 360 L 850 350 L 870 390 L 820 410 L 760 390 Z" fill="#3a3850" stroke="#4a4860" strokeWidth="1"/>
        {/* grid dots */}
        {Array.from({length:200}).map((_,i)=>{
          const x = (i*73)%1000; const y= (i*97)%500;
          return <circle key={i} cx={x} cy={y} r="0.6" fill="#2a2a40" opacity="0.5"/>
        })}
      </svg>
      {/* pulsing dot for connected location — Canada approx 180,130 */}
      {highlighted && (
        <div style={{ position:'absolute', left:'29%', top:'34%', width:28, height:28, background:'rgba(16,196,126,0.25)', borderRadius:999, display:'grid', placeItems:'center', transform:'translate(-50%,-50%)' }}>
          <div style={{ width:14, height:14, background:'#0ac47e', borderRadius:999, border:'3px solid #fff', boxShadow:'0 0 12px rgba(16,196,126,0.9)' }} />
          <div style={{ position:'absolute', inset:0, borderRadius:999, border:'1px solid rgba(16,196,126,0.5)', animation:'pulse 2s infinite' } as any} />
        </div>
      )}
      <style>{`@keyframes pulse{0%{transform:scale(0.8);opacity:0.8}100%{transform:scale(1.6);opacity:0}}`}</style>
      {/* vignette */}
      <div style={{ position:'absolute', inset:0, background:'linear-gradient(to top, #0a0a0f 0%, transparent 40%, transparent 70%, rgba(10,106,90,0.25) 100%)', pointerEvents:'none' }} />
    </div>
  );

  const HomeTab = () => (
    <div style={{ display:'grid', gap:0, background:'#000', minHeight:'100%' }}>
      {/* Protected header */}
      <div style={{
        background: connected ? 'linear-gradient(180deg, #0e6b52 0%, #0a3a2e 60%, #0a0a0f 100%)' : 'linear-gradient(180deg, #1a1a24 0%, #0a0a0f 100%)',
        padding:'14px 16px 10px', textAlign:'center', borderBottom:'1px solid #1a1a24'
      }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:8, color: connected ? '#5eefc1' : '#f87171', fontWeight:800, fontSize:15 }}>
          <span style={{ width:18, height:18, borderRadius:999, background: connected ? '#0ac47e' : '#ef4444', display:'grid', placeItems:'center', fontSize:11, color:'#fff' }}>{connected ? '🔒' : '🔓'}</span>
          {connected ? 'Protected' : 'Not protected'}
        </div>
        {!connected ? (
          <div style={{ marginTop:8, color:'#e5e7eb', fontSize:12, lineHeight:1.6 }}>
            <div style={{ color:'#fbbf24', fontWeight:700 }}>⚠️ IP visible</div>
            <div style={{ color:'#9ca3af', fontSize:11 }}>Your IP is <span style={{ color:'#fff', fontFamily:'monospace', fontWeight:700 }}>{clientIpLoading ? '…' : clientIp || '—'}</span></div>
            <div style={{ color:'#9ca3af', fontSize:11, marginTop:2 }}>Not connected • Your traffic is visible to FortiGate & ISP</div>
            <button onClick={()=>connect()} style={{ marginTop:10, background:'#6d4aff', color:'#fff', border:0, padding:'10px 28px', borderRadius:999, fontWeight:800, cursor:'pointer', fontSize:13 }}>Quick Connect</button>
          </div>
        ) : (
          <div style={{ color:'#a7f3d0', fontSize:11, marginTop:4 }}>Encrypted • {vpnMode==='fast'?'TurboDirect':'GhostPath Stealth'} • RTT {rtt}ms</div>
        )}
        {/* NetShield card */}
        <div style={{ marginTop:14, background:'#1c1b26', border:'1px solid #2a2a38', borderRadius:12, padding:'10px 12px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <span style={{ width:24, height:24, borderRadius:6, background:'linear-gradient(135deg, #0ac47e, #06b6d4)', display:'grid', placeItems:'center', fontSize:12 }}>🛡️</span>
            <div style={{ textAlign:'left' }}>
              <div style={{ color:'#fff', fontWeight:700, fontSize:12 }}>NetShield</div>
              <div style={{ color:'#9ca3af', fontSize:10 }}>{connected ? 'Blocking trackers & malware' : 'Enable after connecting'}</div>
            </div>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:6, color:'#9ca3af', fontSize:12 }}>
            <span style={{ color:'#fff', fontSize:12, fontWeight:700 }}>{connected?'On':'Off'}</span>
            <span>›</span>
          </div>
        </div>
        <div style={{ marginTop:8, background:'#13131a', borderRadius:10, padding:'8px 10px', display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:6, border:'1px solid #1f1f2a' }}>
          <div style={{ textAlign:'center' }}><div style={{ color:'#fff', fontWeight:800, fontSize:13 }}>{ads}</div><div style={{ color:'#8b8da3', fontSize:9 }}>Ads blocked</div></div>
          <div style={{ textAlign:'center', borderLeft:'1px solid #2a2a38', borderRight:'1px solid #2a2a38' }}><div style={{ color:'#fff', fontWeight:800, fontSize:13 }}>{trackers}</div><div style={{ color:'#8b8da3', fontSize:9 }}>Trackers stopped</div></div>
          <div style={{ textAlign:'center' }}><div style={{ color:'#fff', fontWeight:800, fontSize:13 }}>{(saved/1024).toFixed(2)} KB</div><div style={{ color:'#8b8da3', fontSize:9 }}>Data saved</div></div>
        </div>
      </div>

      <WorldMap highlighted={connected} />

      {/* How is your connection? */}
      <div style={{ background:'#0a0a0f', padding:'10px 16px', display:'flex', alignItems:'center', justifyContent:'space-between', borderTop:'1px solid #1a1a24', borderBottom:'1px solid #1a1a24' }}>
        <span style={{ color:'#e5e7eb', fontSize:12 }}>How is your connection?</span>
        <div style={{ display:'flex', gap:12, color:'#6b7280' }}>
          <span style={{ cursor:'pointer' }} title="Bad">👎</span>
          <span style={{ width:1, height:14, background:'#2a2a38' }} />
          <span style={{ cursor:'pointer' }} title="Good">👍</span>
        </div>
      </div>

      {/* Connection card */}
      <div style={{ padding:12, background:'#000', paddingBottom:80 }}>
        {connected ? (
          <div style={{ background:'#1c1b26', border:'1px solid #2a2a38', borderRadius:16, padding:14 }}>
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              <div style={{ width:36, height:36, borderRadius:8, background:'#2a2a38', display:'grid', placeItems:'center', fontSize:14, position:'relative' }}>
                💼<span style={{ position:'absolute', bottom:-2, right:-2, background:'#fff', borderRadius:999, width:14, height:14, display:'grid', placeItems:'center', fontSize:9, border:'1px solid #ddd' }}>🇨🇦</span>
              </div>
              <div style={{ flex:1 }}>
                <div style={{ color:'#fff', fontWeight:700, fontSize:14 }}>{selectedProfile.name}</div>
                <div style={{ color:'#9ca3af', fontSize:12 }}>Canada • {clientIp ? clientIp.slice(0,12)+' • ' : ''}{vpnMode==='fast'?'Turbo':'Stealth'}</div>
              </div>
              <span style={{ color:'#6b7280', fontSize:16, cursor:'pointer' }}>⌃</span>
            </div>
            <button onClick={disconnect} style={{ width:'100%', marginTop:12, background:'#2a2a38', color:'#e5e7eb', border:'1px solid #3a3a4a', padding:'12px', borderRadius:10, fontWeight:700, cursor:'pointer' }}>Disconnect</button>
            <button onClick={()=>setTab('countries')} style={{ width:'100%', marginTop:8, background:'transparent', color:'#e5e7eb', border:'1px solid #2a2a38', padding:'11px', borderRadius:10, fontWeight:600, cursor:'pointer' }}>Change server</button>
            <div style={{ marginTop:10, display:'flex', justifyContent:'center', gap:8 }}>
              <span style={{ width:8, height:8, borderRadius:999, background:'#0ac47e', boxShadow:'0 0 8px #0ac47e' }} />
              <span style={{ color:'#9ca3af', fontSize:11 }}>Protected • {rx>0 ? `${(rx/1024).toFixed(1)} KB ↑ ${(tx/1024).toFixed(1)} KB` : '↓ 0 B ↑ 0 B'}</span>
            </div>
          </div>
        ) : (
          <div style={{ background:'#1c1b26', border:'1px solid #2a2a38', borderRadius:16, padding:14, textAlign:'center' }}>
            <div style={{ color:'#f87171', fontWeight:700, fontSize:13, display:'flex', alignItems:'center', justifyContent:'center', gap:6 }}>🔓 Not protected</div>
            <div style={{ color:'#9ca3af', fontSize:12, marginTop:6, lineHeight:1.5 }}>
              Your IP <span style={{ color:'#fff', fontFamily:'monospace' }}>{clientIpLoading?'…':clientIp}</span> is visible.<br/>
              Connect to hide your location and encrypt traffic.
            </div>
            <div style={{ marginTop:10, display:'flex', gap:8 }}>
              <button onClick={()=>connect()} style={{ flex:1, background:'#6d4aff', color:'#fff', border:0, padding:'12px', borderRadius:10, fontWeight:800, cursor:'pointer' }}>Quick Connect</button>
              <button onClick={()=>setTab('profiles')} style={{ flex:1, background:'transparent', color:'#e5e7eb', border:'1px solid #3a3a4a', padding:'12px', borderRadius:10, fontWeight:600, cursor:'pointer' }}>Change server</button>
            </div>
            <div style={{ marginTop:10, fontSize:11, color:'#6b7280' }}>Default: <span style={{ color:'#a78bfa' }}>{selectedProfile.name} • {selectedProfile.subtitle}</span> • Auto-pick fastest if offline</div>
          </div>
        )}

        {/* stealth/fast toggle + duckdns hint */}
        <div style={{ marginTop:12, background:'#0f0f14', border:'1px solid #1f1f2a', borderRadius:12, padding:10, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div style={{ fontSize:11, color:'#9ca3af' }}>{vpnMode==='fast'?'⚡ Home Turbo':'🛡️ Stealth'} • {vpnMode==='fast'?'Plain WS':'TLS-in-TLS Fortinet-safe'}</div>
          <div style={{ display:'flex', gap:6, background:'#1a1a24', borderRadius:999, padding:3 }}>
            <button onClick={()=>setVpnMode('stealth')} style={{ padding:'5px 10px', borderRadius:999, border:0, fontSize:11, fontWeight:700, cursor:'pointer', background: vpnMode==='stealth'?'#6d4aff':'transparent', color: vpnMode==='stealth'?'#fff':'#9ca3af' }}>Stealth</button>
            <button onClick={()=>setVpnMode('fast')} style={{ padding:'5px 10px', borderRadius:999, border:0, fontSize:11, fontWeight:700, cursor:'pointer', background: vpnMode==='fast'?'#f59e0b':'transparent', color: vpnMode==='fast'?'#fff':'#9ca3af' }}>Turbo</button>
          </div>
        </div>

        {/* Recents placeholder */}
        <div style={{ marginTop:14 }}>
          <div style={{ color:'#e5e7eb', fontWeight:700, fontSize:12, marginBottom:8 }}>Recents</div>
          <div style={{ color:'#6b7280', fontSize:11, textAlign:'center', padding:'12px 0', border:'1px dashed #1f1f2a', borderRadius:10 }}>No recent connections — connect to see history</div>
        </div>

        <div style={{ marginTop:10, fontSize:10, color:'#4b5563', textAlign:'center' }}>OpenPath • {hosts?.online??0}/{hosts?.total??0} hosts • {serverUrl.replace('wss://','').replace('ws://','').split('/')[0]} • PSK hidden</div>
      </div>
    </div>
  );

  const CountriesTab = () => (
    <div style={{ background:'#000', minHeight:'100%', paddingBottom:80 }}>
      <div style={{ padding:'16px 16px 10px', position:'sticky', top:0, background:'#000', zIndex:2 }}>
        <div style={{ color:'#fff', fontWeight:800, fontSize:18 }}>Countries</div>
        <div style={{ color:'#9ca3af', fontSize:11, marginTop:4 }}>Pick fastest exit — like Proton. App fetches <code style={{ background:'#1a1a24', padding:'2px 6px', borderRadius:6 }}>GET /api/hosts</code> once, not constantly.</div>
        <div style={{ marginTop:10, display:'flex', gap:6 }}>
          <input value={serverUrl} onChange={e=>setServerUrl(e.target.value)} style={{ flex:1, background:'#1a1a24', border:'1px solid #2a2a38', color:'#e5e7eb', padding:'8px 10px', borderRadius:8, fontSize:11, fontFamily:'monospace' }} />
          <button onClick={async()=>{
            try{
              const r=await fetch('/api/hosts'); if(r.ok){ const d=await r.json(); setHosts(d); log('Manual refresh: '+d.online+' online')}
            }catch(e:any){ log('Refresh fail: '+e.message)}
          }} style={{ background:'#1a1a24', border:'1px solid #2a2a38', color:'#e5e7eb', padding:'0 12px', borderRadius:8, cursor:'pointer', fontSize:12 }}>↻</button>
        </div>
      </div>
      <div style={{ padding:'0 12px', display:'grid', gap:8 }}>
        {COUNTRIES.map(c=>(
          <div key={c.code} onClick={()=>{ const fake={ name:c.name, subtitle:c.cities[0], icon:'🌍', color:'#6d4aff', flag:c.flag} as ProfileRow; setSelectedProfile(fake); setTab('home'); connect(undefined, fake)}} style={{ background:'#12121a', border:'1px solid #1f1f2a', borderRadius:12, padding:'12px 14px', display:'flex', alignItems:'center', justifyContent:'space-between', cursor:'pointer' }}>
            <div style={{ display:'flex', gap:10, alignItems:'center' }}>
              <span style={{ fontSize:22 }}>{c.flag}</span>
              <div>
                <div style={{ color:'#fff', fontWeight:700, fontSize:13 }}>{c.name} <span style={{ color:'#6b7280', fontWeight:400, fontSize:11 }}>• {c.cities.join(', ')}</span></div>
                <div style={{ color:'#9ca3af', fontSize:11 }}>{c.load}% load • {c.p2p?'P2P • ':''}{c.tor?'Tor • ':''}Stealth</div>
              </div>
            </div>
            <span style={{ color:'#6d4aff', fontSize:11, fontWeight:700, border:'1px solid #6d4aff', padding:'4px 8px', borderRadius:999 }}>Connect</span>
          </div>
        ))}
        {hosts && (
          <div style={{ background:'#0f0f14', border:'1px solid #1f1f2a', borderRadius:12, padding:12 }}>
            <div style={{ color:'#e5e7eb', fontWeight:700, fontSize:12 }}>Directory (Main + Subs from Docker/DuckDNS)</div>
            <div style={{ color:'#fff', fontFamily:'monospace', fontSize:11, marginTop:6 }}>{hosts.main?.wssUrl}</div>
            <div style={{ color:'#9ca3af', fontSize:11, marginTop:4 }}>{hosts.hosts.length} subs online • manual refresh only (not auto-polling)</div>
          </div>
        )}
      </div>
    </div>
  );

  const ProfilesTab = () => (
    <div style={{ background:'#000', minHeight:'100%', paddingBottom:80 }}>
      <div style={{ padding:'16px 16px 0', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div style={{ color:'#fff', fontWeight:800, fontSize:18 }}>Profiles</div>
        <span style={{ color:'#9ca3af', fontSize:11, border:'1px solid #2a2a38', padding:'4px 8px', borderRadius:999 }}>Info ⓘ</span>
      </div>
      <div style={{ padding:8 }}>
        {PROFILES.map(p=>(
          <div key={p.id} onClick={()=>{ setSelectedProfile(p); if(!connected) connect(undefined,p); else setTab('home');}} style={{ display:'flex', alignItems:'center', gap:12, padding:'14px 12px', borderBottom:'1px solid #12121a', cursor:'pointer', background: selectedProfile.id===p.id && connected ? '#12121a' : 'transparent' }}>
            <div style={{ width:36, height:36, borderRadius:8, background:'#1e1b2e', display:'grid', placeItems:'center', fontSize:16, position:'relative' }}>
              <span>{p.icon}</span>
              {p.fast && <span style={{ position:'absolute', bottom:-4, right:-4, background:'#0ac47e', width:16, height:16, borderRadius:4, display:'grid', placeItems:'center', fontSize:9, border:'1px solid #000' }}>⚡</span>}
              {p.flag && <span style={{ position:'absolute', bottom:-2, right:-2, background:'#1a1a24', borderRadius:4, padding:'1px 3px', fontSize:8, border:'1px solid #2a2a38' }}>{p.flag}</span>}
            </div>
            <div style={{ flex:1 }}>
              <div style={{ color:'#fff', fontWeight:700, fontSize:13, display:'flex', alignItems:'center', gap:6 }}>{p.name} {p.connected && connected && <span style={{ width:8, height:8, background:'#0ac47e', borderRadius:999, boxShadow:'0 0 6px #0ac47e' }} />}</div>
              <div style={{ color:'#9ca3af', fontSize:11 }}>{p.subtitle}</div>
            </div>
            <span style={{ color:'#6b7280', fontSize:16 }}>⋯</span>
          </div>
        ))}
      </div>
      <div style={{ padding:'16px 12px 40px' }}>
        <button style={{ width:'100%', background:'#6d4aff', color:'#fff', border:0, padding:'14px', borderRadius:12, fontWeight:800, cursor:'pointer' }}>Create profile</button>
        <div style={{ color:'#4b5563', fontSize:11, textAlign:'center', marginTop:8 }}>Custom profiles save country + NetShield + Stealth settings</div>
      </div>
    </div>
  );

  const SettingsTab = () => {
    const isProfileLocked = connected && selectedProfile.id==='school';
    if(isProfileLocked){
      return (
        <div style={{ background:'#000', minHeight:'100%', paddingBottom:80 }}>
          <div style={{ padding:'12px 16px 0' }}>
            <div style={{ background:'#1e1b2e', border:'1px solid #2a2a38', borderRadius:10, padding:'10px 12px', display:'flex', gap:10, alignItems:'center' }}>
              <span style={{ background:'#6d4aff', width:24, height:24, borderRadius:6, display:'grid', placeItems:'center', fontSize:12 }}>💼</span>
              <span style={{ color:'#e5e7eb', fontSize:11, lineHeight:1.4 }}>These settings are connected to <b style={{ color:'#fff' }}>School</b> and can only be managed in Profiles.</span>
            </div>
          </div>
          <div style={{ padding:16 }}>
            <div style={{ color:'#a78bfa', fontSize:11, fontWeight:700, letterSpacing:0.5, textTransform:'uppercase' }}>Account</div>
            <div style={{ marginTop:10, display:'flex', gap:10, alignItems:'center' }}>
              <div style={{ width:28, height:28, borderRadius:999, background:'#6d4aff', display:'grid', placeItems:'center', color:'#fff', fontWeight:800, fontSize:12 }}>M</div>
              <div>
                <div style={{ color:'#fff', fontWeight:700, fontSize:12 }}>mob5824</div>
                <div style={{ color:'#9ca3af', fontSize:11 }}>mob5824@proton.me</div>
              </div>
            </div>
            <div style={{ color:'#a78bfa', fontSize:11, fontWeight:700, marginTop:18 }}>Features</div>
            <div style={{ marginTop:10, display:'grid', gap:10 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <span style={{ display:'flex', gap:10, alignItems:'center', color:'#e5e7eb', fontSize:13 }}><span style={{ width:24, height:24, borderRadius:6, background:'#0ac47e', display:'grid', placeItems:'center' }}>🛡️</span>NetShield</span>
                <span style={{ background:'#1a1a24', border:'1px solid #2a2a38', padding:'4px 8px', borderRadius:6, color:'#e5e7eb', fontSize:11, display:'flex', gap:6, alignItems:'center' }}><span style={{ background:'#6d4aff', color:'#fff', padding:'1px 6px', borderRadius:999, fontSize:9 }}>🇨🇦</span>On</span>
              </div>
              <div style={{ background:'#12121a', borderRadius:10, padding:'12px 14px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <span style={{ display:'flex', gap:10, color:'#e5e7eb', fontSize:13 }}><span>↗️</span>Split tunneling</span>
                <span style={{ color:'#9ca3af', fontSize:11 }}>Off</span>
              </div>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <span style={{ display:'flex', gap:10, color:'#e5e7eb', fontSize:13 }}><span>⛔</span>Kill switch</span>
                <span style={{ color:'#6b7280' }}>›</span>
              </div>
            </div>
            <div style={{ color:'#a78bfa', fontSize:11, fontWeight:700, marginTop:18 }}>Connection</div>
            <div style={{ marginTop:10, display:'grid', gap:12 }}>
              <div style={{ display:'flex', gap:10, color:'#e5e7eb', fontSize:13 }}><span>🔖</span>Connection preferences <span style={{ marginLeft:'auto', color:'#6b7280' }}>›</span></div>
              <div style={{ display:'flex', gap:10, color:'#e5e7eb', fontSize:13 }}><span>🧩</span>Protocol <span style={{ marginLeft:'auto', background:'#1a1a24', border:'1px solid #2a2a38', padding:'2px 8px', borderRadius:6, fontSize:11, display:'flex', gap:6 }}><span style={{ background:'#6d4aff', color:'#fff', padding:'1px 4px', borderRadius:4, fontSize:9 }}>🇨🇦</span>Stealth</span></div>
              <div style={{ display:'flex', gap:10, color:'#e5e7eb', fontSize:13 }}><span>🎛️</span>Advanced settings <span style={{ marginLeft:'auto', color:'#6b7280' }}>›</span></div>
            </div>
          </div>
        </div>
      )
    }
    // General settings (not locked) — screenshot 3
    return (
      <div style={{ background:'#000', minHeight:'100%', paddingBottom:80 }}>
        <div style={{ padding:'12px 16px' }}>
          <div style={{ color:'#fff', fontWeight:800, fontSize:18 }}>Settings</div>
          <div style={{ marginTop:14, color:'#a78bfa', fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:0.5 }}>General</div>
          <div style={{ marginTop:8, display:'grid', gap:1 }}>
            {[
              { icon:'🔔', name:'Notifications', sub:'' },
              { icon:'◐', name:'Theme', sub:'Dark' },
              { icon:'⊞', name:'App icon', sub:'' },
              { icon:'📱', name:'Widget', sub:'' },
              { icon:'🔧', name:'hxreborn patches', sub:'' },
            ].map(it=>(
              <div key={it.name} style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 0', borderBottom:'1px solid #12121a' }}>
                <span style={{ fontSize:14, width:20, textAlign:'center', color:'#e5e7eb' }}>{it.icon}</span>
                <div style={{ flex:1 }}>
                  <div style={{ color:'#e5e7eb', fontSize:13, fontWeight:600 }}>{it.name}</div>
                  {it.sub && <div style={{ color:'#9ca3af', fontSize:11 }}>{it.sub}</div>}
                </div>
                <span style={{ color:'#6b7280' }}>›</span>
              </div>
            ))}
          </div>
          <div style={{ color:'#a78bfa', fontSize:11, fontWeight:700, marginTop:14, textTransform:'uppercase' }}>Support</div>
          <div style={{ marginTop:8 }}>
            {[
              { icon:'🛟', name:'Support center', ext:true },
              { icon:'🐞', name:'Report an issue', active:true },
              { icon:'</>', name:'Debug logs', ext:false },
            ].map(it=>(
              <div key={it.name} style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 8px', background: it.active?'#1a1a24':'transparent', borderRadius:8 }}>
                <span style={{ fontSize:14 }}>{it.icon}</span>
                <span style={{ flex:1, color:'#e5e7eb', fontSize:13 }}>{it.name}</span>
                {it.ext && <span style={{ border:'1px solid #2a2a38', padding:'2px 6px', borderRadius:4, fontSize:10, color:'#9ca3af' }}>↗</span>}
              </div>
            ))}
          </div>
          <div style={{ color:'#a78bfa', fontSize:11, fontWeight:700, marginTop:14, textTransform:'uppercase' }}>Improve Proton</div>
          <div style={{ marginTop:8 }}>
            <div style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 0' }}><span>👥</span><span style={{ flex:1, color:'#e5e7eb', fontSize:13 }}>Help us fight censorship</span></div>
            <div style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 0' }}><span>⭐</span><span style={{ flex:1, color:'#e5e7eb', fontSize:13 }}>Rate Proton VPN</span><span style={{ border:'1px solid #2a2a38', padding:'2px 6px', borderRadius:4, fontSize:10 }}>↗</span></div>
          </div>
          <div style={{ marginTop:16, display:'flex', gap:12, color:'#e5e7eb', fontSize:13, padding:'12px 0', borderTop:'1px solid #12121a' }}><span>↪️</span>Sign out</div>
        </div>
      </div>
    );
  };

  const BottomNav = () => (
    <div style={{ position:'fixed', bottom:0, left:0, right:0, height:58, background:'#12101d', borderTop:'1px solid #1f1f2a', display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', alignItems:'center', padding:'0 8px', zIndex:20 }}>
      {[
        { id:'home', label:'Home', icon:'⌂' },
        { id:'countries', label:'Countries', icon:'◍' },
        { id:'profiles', label:'Profiles', icon:'▭' },
        { id:'settings', label:'Settings', icon:'⚙' },
      ].map(it=>{
        const active = tab===it.id;
        return (
          <button key={it.id} onClick={()=>setTab(it.id as any)} style={{ background:'transparent', border:0, cursor:'pointer', display:'flex', flexDirection:'column', alignItems:'center', gap:2, color: active?'#a78bfa':'#6b7280' }}>
            <span style={{ width:32, height:26, borderRadius:999, background: active?'#6d4aff':'transparent', display:'grid', placeItems:'center', color: active?'#fff':'#6b7280', fontSize:14 }}>{it.icon}</span>
            <span style={{ fontSize:10, fontWeight: active?700:500 }}>{it.label}</span>
          </button>
        )
      })}
    </div>
  );

  return (
    <div style={{ fontFamily:'Inter, system-ui, sans-serif', background:'#000', minHeight:'100vh', color:'#e5e7eb', display:'flex', flexDirection:'column', maxWidth:440, margin:'0 auto', borderLeft:'1px solid #1a1a24', borderRight:'1px solid #1a1a24', position:'relative' }}>
      <TopChrome />
      <PersistentNotification onDisconnect={disconnect} />
      <div style={{ flex:1, overflow:'auto', WebkitOverflowScrolling:'touch' as any }}>
        {tab==='home' && <HomeTab />}
        {tab==='countries' && <CountriesTab />}
        {tab==='profiles' && <ProfilesTab />}
        {tab==='settings' && <SettingsTab />}
      </div>
      <BottomNav />
      {/* hidden logs for debugging — accessible via Settings > Debug logs */}
      <div style={{ display:'none' }}>{logs.map((l,i)=><div key={i}>{l}</div>)}</div>
    </div>
  )
}
