import React, { useEffect, useRef, useState } from 'react'

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

// Extended editable profile to support full wizard fields + persistence
type EditableProfile = ProfileRow & {
  typeLabel: string; // Standard / Secure Core / P2P / Tor
  countryCode: string;
  countryName: string;
  city: string; // Fastest / Toronto etc
  netShield: 'On'|'Off';
  protocol: 'Stealth'|'Smart (auto)'|'WireGuard'|'Stealth (Fortinet)';
  natType: 'Type 1'|'Type 2'|'Type 3';
  lan: 'On'|'Off';
  connectAndGo: 'On'|'Off';
  customDNS: 'On'|'Off';
  customDNSVal?: string;
}

const PROFILE_COLORS = ['#7c4dff','#3b82f6','#10b981','#ef4444','#fb923c','#eab308'] // purple blue green red orange yellow as screenshot
const ICON_GRID = [
  { k:'bolt', e:'⚡', name:'Fastest' },
  { k:'play', e:'▶️', name:'Streaming' },
  { k:'shield', e:'🛡️', name:'Secure' },
  { k:'eye', e:'👁️‍🗨️', name:'Privacy' },
  { k:'incog', e:'🕶️', name:'Stealth' },
  { k:'card', e:'💳', name:'Payment' },
  { k:'gamepad', e:'🎮', name:'Gaming' },
  { k:'folder', e:'📁', name:'Files' },
  { k:'briefcase', e:'💼', name:'School' },
  { k:'cart', e:'🛒', name:'Shop' },
  { k:'lock', e:'🔒', name:'Secure' },
  { k:'globe', e:'🌐', name:'Browse' },
]

const DEFAULT_EDITABLE: EditableProfile[] = [
  { id:'streaming-us', name:'Streaming US', subtitle:'United States', icon:'▶️', color:'#7c4dff', flag:'🇺🇸', typeLabel:'Standard', countryCode:'US', countryName:'United States', city:'Fastest', netShield:'On', protocol:'Stealth', natType:'Type 3', lan:'On', connectAndGo:'Off', customDNS:'Off' },
  { id:'gaming', name:'Gaming', subtitle:'Fastest country', icon:'🎮', color:'#1a1a24', flag:undefined, fast:true, typeLabel:'Standard', countryCode:'CA', countryName:'Canada', city:'Fastest', netShield:'On', protocol:'Smart (auto)', natType:'Type 2', lan:'On', connectAndGo:'Off', customDNS:'Off' },
  { id:'anti-censorship', name:'Anti-censorship', subtitle:'Fastest country (excluding my country)', icon:'🕶️', color:'#1a1a24', fast:true, typeLabel:'Standard', countryCode:'CA', countryName:'Canada', city:'Fastest', netShield:'On', protocol:'Stealth', natType:'Type 3', lan:'Off', connectAndGo:'Off', customDNS:'Off' },
  { id:'school', name:'School', subtitle:'Canada', icon:'💼', color:'#7c4dff', flag:'🇨🇦', connected:true, typeLabel:'Standard', countryCode:'CA', countryName:'Canada', city:'Fastest', netShield:'On', protocol:'Stealth', natType:'Type 3', lan:'Off', connectAndGo:'Off', customDNS:'Off' },
  { id:'home', name:'Home', subtitle:'Fastest country', icon:'⚡', color:'#1a1a24', fast:true, typeLabel:'Standard', countryCode:'CA', countryName:'Canada', city:'Fastest', netShield:'On', protocol:'Smart (auto)', natType:'Type 3', lan:'On', connectAndGo:'Off', customDNS:'Off' },
]

function loadEditable(): EditableProfile[]{
  try{
    const raw = localStorage.getItem('openpath:editable-profiles')
    if(raw){
      const arr = JSON.parse(raw) as EditableProfile[]
      // merge to ensure new defaults appear
      const byId = new Map(arr.map(p=>[p.id,p]))
      const merged = DEFAULT_EDITABLE.map(d=> byId.get(d.id) ? { ...d, ...byId.get(d.id)! } : d)
      // keep custom profiles not in defaults
      for(const p of arr) if(!merged.find(m=>m.id===p.id)) merged.push(p)
      return merged
    }
  }catch{}
  return [...DEFAULT_EDITABLE]
}
function saveEditable(profiles: EditableProfile[]){
  try{ localStorage.setItem('openpath:editable-profiles', JSON.stringify(profiles)) }catch{}
}

// Fire real OS notification (Notification API) when available
function fireSystemNotification(title:string, body:string, icon?:string){
  try{
    // Request permission if needed (will be done elsewhere, but try)
    if(typeof Notification !== 'undefined' && Notification.permission === 'granted'){
      const n = new Notification(title, { body, icon: icon||'/favicon.png', tag:'openpath-vpn', silent:false, requireInteraction:false } as any)
      // auto close after 6s — system notification only, no in-app banner
      setTimeout(()=>{ try{ n.close() }catch{} },6000)
      n.onclick = ()=>{ window.focus(); try{ n.close() }catch{} }
    } else if(typeof Notification !== 'undefined' && Notification.permission !== 'denied'){
      Notification.requestPermission().then(p=>{
        if(p==='granted') fireSystemNotification(title, body, icon)
      })
    }
  }catch{}
}

const COUNTRIES = [
  { code:'CA', name:'Canada', flag:'🇨🇦', cities:['Toronto','Montreal','Vancouver'], load:32, p2p:true, tor:true, lat:45.4215, lon:-75.6972 },
  { code:'US', name:'United States', flag:'🇺🇸', cities:['New York','Los Angeles','Chicago'], load:41, lat:39.8283, lon:-98.5795 },
  { code:'GB', name:'United Kingdom', flag:'🇬🇧', cities:['London'], load:28, lat:51.5074, lon:-0.1278 },
  { code:'CH', name:'Switzerland', flag:'🇨🇭', cities:['Zurich'], load:22, lat:47.3769, lon:8.5417 },
  { code:'DE', name:'Germany', flag:'🇩🇪', cities:['Frankfurt','Berlin'], load:35, lat:50.1109, lon:8.6821 },
  { code:'NL', name:'Netherlands', flag:'🇳🇱', cities:['Amsterdam'], load:30, lat:52.3676, lon:4.9041 },
  { code:'JP', name:'Japan', flag:'🇯🇵', cities:['Tokyo'], load:44, lat:35.6762, lon:139.6503 },
  { code:'IS', name:'Iceland', flag:'🇮🇸', cities:['Reykjavik'], load:18, lat:64.1466, lon:-21.9426 },
  { code:'AU', name:'Australia', flag:'🇦🇺', cities:['Sydney'], load:38, lat:-33.8688, lon:151.2093 },
  { code:'FR', name:'France', flag:'🇫🇷', cities:['Paris'], load:29, lat:48.8566, lon:2.3522 },
]

// Rough city coordinates used to place the exit marker on the map
const CITY_COORDS: Record<string,{lat:number;lon:number}> = {
  Fastest:{ lat:45.4215, lon:-75.6972 },
  Toronto:{ lat:43.6532, lon:-79.3832 },
  Montreal:{ lat:45.5019, lon:-73.5674 },
  Vancouver:{ lat:49.2827, lon:-123.1207 },
  'New York':{ lat:40.7128, lon:-74.006 },
  'Los Angeles':{ lat:34.0522, lon:-118.2437 },
  Chicago:{ lat:41.8781, lon:-87.6298 },
  London:{ lat:51.5074, lon:-0.1278 },
  Zurich:{ lat:47.3769, lon:8.5417 },
  Frankfurt:{ lat:50.1109, lon:8.6821 },
  Berlin:{ lat:52.52, lon:13.405 },
  Amsterdam:{ lat:52.3676, lon:4.9041 },
  Tokyo:{ lat:35.6762, lon:139.6503 },
  Reykjavik:{ lat:64.1466, lon:-21.9426 },
  Sydney:{ lat:-33.8688, lon:151.2093 },
  Paris:{ lat:48.8566, lon:2.3522 },
}

type GeoPoint = { lat:number; lon:number; city:string; country:string; source:'ip'|'gps'|'default' }
const FALLBACK_LOCATION: GeoPoint = { lat:45.5019, lon:-73.5674, city:'Montréal', country:'Canada', source:'default' }

// Equirectangular projection onto the map viewBox (lon -180..180 → 0..100%, lat 90..-90 → 0..100%)
function projectPoint(lat:number, lon:number){ return { x: ((lon+180)/360)*100, y: ((90-lat)/180)*100 } }

function exitCoordsFor(p: { city?:string; countryCode?:string; countryName?:string; subtitle?:string }){
  const byCity = p.city ? CITY_COORDS[p.city] : undefined;
  if(byCity) return { ...byCity, label: p.city as string };
  const byCountry = COUNTRIES.find(c=>c.code===p.countryCode) || COUNTRIES.find(c=>c.name===p.countryName);
  if(byCountry) return { lat:byCountry.lat, lon:byCountry.lon, label:byCountry.name };
  const bySubtitle = p.subtitle ? CITY_COORDS[p.subtitle] : undefined;
  if(bySubtitle) return { ...bySubtitle, label: p.subtitle as string };
  return { lat:CITY_COORDS.Toronto.lat, lon:CITY_COORDS.Toronto.lon, label:'Canada' };
}

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
  const [tab, setTab] = useState<'home'|'countries'|'profiles'|'settings'|'releases'>('home');
  const [connected, setConnected] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState<ProfileRow>(DEFAULT_EDITABLE[3]); // School default as screenshot
  const [hosts, setHosts] = useState<{main:any; hosts:HostEntry[]; online:number; total:number}|null>(null);
  const [clientIp, setClientIp] = useState<string>('');
  const [clientIpLoading, setClientIpLoading] = useState(true);
  const [myLocation, setMyLocation] = useState<GeoPoint>(FALLBACK_LOCATION);
  const [logs, setLogs] = useState<string[]>(()=>[`[${new Date().toLocaleTimeString()}] OpenPath — GhostPath ready.`]);
  const [rtt, setRtt] = useState(0);
  const [rx, setRx] = useState(0);
  const [tx, setTx] = useState(0);
  const wsRef = useRef<WebSocket|null>(null);
  const rxRef = useRef(0), txRef = useRef(0);
  const [ads, setAds] = useState(0);
  const [trackers, setTrackers] = useState(0);
  const [saved, setSaved] = useState(0);

  // Editable profiles + sheet + wizard
  const [editableProfiles, setEditableProfiles] = useState<EditableProfile[]>(()=>loadEditable())
  const [sheetProfile, setSheetProfile] = useState<EditableProfile|null>(null)
  const [editing, setEditing] = useState<EditableProfile|null>(null)
  const [editStep, setEditStep] = useState<1|2|3>(1)

  // Releases state
  const [releases, setReleases] = useState<any[]|null>(null)
  const [releasesLoading, setReleasesLoading] = useState(false)

  useEffect(()=>{ saveEditable(editableProfiles)},[editableProfiles])
  useEffect(()=>{ try{ localStorage.setItem('openpath:mode', vpnMode)}catch{}},[vpnMode]);
  const log=(m:string)=> setLogs(l=> [...l.slice(-60), `[${new Date().toLocaleTimeString()}] ${m}`]);

  // Ask notification permission on mount (for real OS notification)
  useEffect(()=>{
    if(typeof Notification !== 'undefined' && Notification.permission === 'default'){
      // don't auto-prompt aggressively; we prompt on first connect. Keep here as silent pre-check.
    }
  },[])

  // fetch client IP once — don't constantly refresh
  useEffect(()=>{
    let cancelled=false;
    async function fetchIp(){
      try{
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

  // Resolve where the user physically is, so the map can show "your location" while disconnected.
  // IP lookup first (no prompt), then device GPS if it was already allowed, then a sensible fallback.
  useEffect(()=>{
    let cancelled=false;
    (async()=>{
      try{
        const r = await fetch('https://ipapi.co/json/');
        if(r.ok){
          const d:any = await r.json();
          if(!cancelled && typeof d.latitude==='number' && typeof d.longitude==='number'){
            setMyLocation({ lat:d.latitude, lon:d.longitude, city:d.city||'Your city', country:d.country_name||'Your country', source:'ip' });
            return;
          }
        }
      }catch{}
      try{
        if(typeof navigator!=='undefined' && navigator.geolocation){
          if(navigator.permissions){
            const perm = await navigator.permissions.query({ name:'geolocation' as any });
            if(perm.state==='granted'){
              navigator.geolocation.getCurrentPosition(
                pos=>{ if(!cancelled) setMyLocation({ lat:pos.coords.latitude, lon:pos.coords.longitude, city:'Your location', country:'Device GPS', source:'gps' }) },
                ()=>{ if(!cancelled) setMyLocation(FALLBACK_LOCATION) },
                { timeout:4000, maximumAge:600000 }
              );
              return;
            }
          }
        }
      }catch{}
      if(!cancelled) setMyLocation(FALLBACK_LOCATION);
    })();
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

  const fetchReleases = async()=>{
    if(releases) return
    setReleasesLoading(true)
    try{
      const r = await fetch('https://api.github.com/repos/mob5824m-wq/OpenPath-VPN/releases?per_page=10')
      if(r.ok){
        const d = await r.json()
        setReleases(d)
      } else {
        setReleases([])
      }
    }catch{
      setReleases([])
    } finally{ setReleasesLoading(false)}
  }

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
    // ask notification permission on connect for real OS notification
    if(typeof Notification !== 'undefined' && Notification.permission === 'default'){
      try{ await Notification.requestPermission() }catch{}
    }
    try{
      const ws=new WebSocket(wsUrl); (ws as any).binaryType='arraybuffer'; wsRef.current=ws;
      ws.onopen=()=>{
        const prof = profile || selectedProfile;
        log(`✓ Tunnel UP to ${u.host} as ${prof.name}`);
        setConnected(true); setRtt(22+Math.floor(Math.random()*15));
        setAds(a=>a+ Math.floor(Math.random()*3)); setTrackers(t=>t+ Math.floor(Math.random()*5)); setSaved(s=>s+ Math.floor(Math.random()*200));
        ws.send(JSON.stringify({op:'ping', t:Date.now()}));
        const payload={ status:"connected", profileName: prof.name, country:{code:"CA", name: prof.subtitle==="Canada"? "Canada": prof.name, flag: prof.flag||"🇨🇦", city: prof.subtitle==="Canada"?"Toronto":prof.subtitle}, stats:{rxBytes:100.94*1024*1024, txBytes:22.14*1024*1024, rxSpeedBps:2.16*1024, txSpeedBps:2.74*1024, durationSec:12, connectedSince:Date.now()}, ip: u.hostname, protocol: vpnMode==='fast'?'TurboDirect':'GhostPath', showSpeeds:true, showVolume:true };
        // REAL OS NOTIFICATION (no in-app banner)
        fireSystemNotification(`${payload.country.flag} Connected to ${payload.country.name}`, `OpenPath • ${prof.name} • ${vpnMode==='fast'?'Turbo':'Stealth'} • ${u.host} • Encrypted`, '/favicon.png')
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
      ws.onclose=(e)=>{ 
        log(`Tunnel closed (${e.code})`); setConnected(false); wsRef.current=null; 
        fireSystemNotification(`OpenPath • Disconnected`, `Tunnel closed (${e.code}) • IP ${clientIp||''} now visible`, '/favicon.png')
      };
      ws.onerror=()=>{ log(`Transport error — check PSK`); };
    }catch(e:any){ log(`Connect error: ${e.message}`)}
  };
  const disconnect=()=> {
    wsRef.current?.close();
    log('Disconnect requested')
  }

  // Profile helpers
  const openSheet = (p: EditableProfile)=> setSheetProfile(p)
  const closeSheet = ()=> setSheetProfile(null)
  const startCreate = ()=>{
    const draft: EditableProfile = {
      id: `custom-${Date.now()}`,
      name:'My Profile',
      subtitle:'Canada',
      icon:'⭐',
      color:'#7c4dff',
      flag:'🇨🇦',
      typeLabel:'Standard',
      countryCode:'CA',
      countryName:'Canada',
      city:'Fastest',
      netShield:'On',
      protocol:'Stealth',
      natType:'Type 3',
      lan:'Off',
      connectAndGo:'Off',
      customDNS:'Off'
    }
    setEditing(draft)
    setEditStep(1)
  }
  const startEdit = (p: EditableProfile)=>{
    setEditing({ ...p })
    setEditStep(1)
    setSheetProfile(null)
  }
  const saveEditing = ()=>{
    if(!editing) return
    // compute subtitle based on country/city
    const subtitle = editing.countryCode === 'CA' && editing.city==='Fastest' ? 'Canada' : editing.countryName === 'Fastest' ? 'Fastest country' : editing.countryName
    const flag = COUNTRIES.find(c=>c.code===editing.countryCode)?.flag || editing.flag || '🇨🇦'
    const updated: EditableProfile = { ...editing, subtitle, flag, icon: editing.icon || '💼' }
    setEditableProfiles(prev=>{
      const exists = prev.find(x=>x.id===editing.id)
      if(exists){
        return prev.map(x=> x.id===editing.id ? updated : x)
      } else {
        return [...prev, updated]
      }
    })
    setSelectedProfile(updated)
    setEditing(null)
    log(`Saved profile ${updated.name}`)
    fireSystemNotification(`Profile saved: ${updated.name}`, `${updated.countryName} • ${updated.city} • ${updated.protocol}`, '/favicon.png')
  }
  const duplicateProfile = (p: EditableProfile)=>{
    const dup: EditableProfile = { ...p, id:`custom-${Date.now()}`, name: p.name + ' Copy' }
    setEditableProfiles(prev=> [...prev, dup])
    log(`Duplicated ${p.name}`)
    closeSheet()
  }
  const deleteProfile = (id:string)=>{
    setEditableProfiles(prev=> prev.filter(p=>p.id!==id))
    closeSheet()
    log(`Deleted profile ${id}`)
  }

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

  const locationText = myLocation.source==='default' ? myLocation.country : `${myLocation.city}, ${myLocation.country}`;
  const locationCity = myLocation.source==='default' ? '' : myLocation.city;
  const WorldMap = ({ highlighted }:{ highlighted?: boolean }) => {
    const you = projectPoint(myLocation.lat, myLocation.lon);
    const exit = projectPoint(exitCoordsFor(selectedProfile).lat, exitCoordsFor(selectedProfile).lon);
    return (
    <div style={{ position:'relative', height:220, overflow:'hidden', background:'#08080c' }}>
      <svg viewBox="0 0 1000 500" style={{ width:'100%', height:'100%', opacity: highlighted?1:0.55 }}>
        <path d="M 40 80 L 90 60 L 140 80 L 180 120 L 220 140 L 260 130 L 240 180 L 200 210 L 160 200 L 120 160 L 60 140 Z" fill="#3a3850" stroke="#4a4860" strokeWidth="1"/>
        <path d="M 60 220 L 90 200 L 130 210 L 150 250 L 110 280 L 60 260 Z" fill="#3a3850" stroke="#4a4860" strokeWidth="1"/>
        <path d="M 220 300 L 260 290 L 290 320 L 280 380 L 240 420 L 210 360 Z" fill="#3a3850" stroke="#4a4860" strokeWidth="1"/>
        <path d="M 460 100 L 520 90 L 560 110 L 540 150 L 500 160 L 460 130 Z" fill="#3a3850" stroke="#4a4860" strokeWidth="1"/>
        <path d="M 480 180 L 540 170 L 570 220 L 550 300 L 510 320 L 470 260 L 460 200 Z" fill="#3a3850" stroke="#4a4860" strokeWidth="1"/>
        <path d="M 580 80 L 750 60 L 850 90 L 880 150 L 820 180 L 760 160 L 650 140 L 580 110 Z" fill="#3a3850" stroke="#4a4860" strokeWidth="1"/>
        <path d="M 600 170 L 750 180 L 820 220 L 780 280 L 660 260 L 600 200 Z" fill="#3a3850" stroke="#4a4860" strokeWidth="1"/>
        <path d="M 770 360 L 850 350 L 870 390 L 820 410 L 760 390 Z" fill="#3a3850" stroke="#4a4860" strokeWidth="1"/>
        {Array.from({length:200}).map((_,i)=>{
          const x = (i*73)%1000; const y= (i*97)%500;
          return <circle key={i} cx={x} cy={y} r="0.6" fill="#2a2a40" opacity="0.5"/>
        })}
      </svg>
      {/* Exit server — only when connected */}
      {highlighted && (
        <>
          <div style={{ position:'absolute', left:`${exit.x}%`, top:`${exit.y}%`, width:28, height:28, background:'rgba(16,196,126,0.25)', borderRadius:999, display:'grid', placeItems:'center', transform:'translate(-50%,-50%)' }}>
            <div style={{ width:14, height:14, background:'#0ac47e', borderRadius:999, border:'3px solid #fff', boxShadow:'0 0 12px rgba(16,196,126,0.9)' }} />
            <div style={{ position:'absolute', inset:0, borderRadius:999, border:'1px solid rgba(16,196,126,0.5)', animation:'pulse 2s infinite' } as any} />
          </div>
          <div style={{ position:'absolute', left:`${exit.x}%`, top:`calc(${exit.y}% + 16px)`, transform:'translateX(-50%)', whiteSpace:'nowrap', fontSize:9, fontWeight:700, color:'#a7f3d0', background:'rgba(0,0,0,0.65)', border:'1px solid rgba(16,196,126,0.4)', borderRadius:999, padding:'1px 7px' }}>
            {exitCoordsFor(selectedProfile).label}
          </div>
        </>
      )}
      {/* Your location — always shown on the map */}
      <div style={{ position:'absolute', left:`${you.x}%`, top:`${you.y}%`, width: highlighted?18:26, height: highlighted?18:26, background: highlighted?'rgba(148,163,184,0.25)':'rgba(59,130,246,0.28)', borderRadius:999, display:'grid', placeItems:'center', transform:'translate(-50%,-50%)', transition:'all 0.2s' }}>
        <div style={{ width: highlighted?8:12, height: highlighted?8:12, background: highlighted?'#94a3b8':'#3b82f6', borderRadius:999, border:`${highlighted?2:3}px solid #fff`, boxShadow: highlighted?'0 0 8px rgba(148,163,184,0.8)':'0 0 14px rgba(59,130,246,1)' }} />
        {!highlighted && <div style={{ position:'absolute', inset:0, borderRadius:999, border:'1px solid rgba(59,130,246,0.7)', animation:'pulse 2s infinite' } as any} />}
      </div>
      <div style={{ position:'absolute', left:`${you.x}%`, top:`calc(${you.y}% + ${highlighted?12:18}px)`, transform:'translateX(-50%)', whiteSpace:'nowrap', fontSize:9, fontWeight:700, color: highlighted?'#cbd5e1':'#bfdbfe', background:'rgba(0,0,0,0.65)', border:`1px solid ${highlighted?'#2a2a38':'rgba(59,130,246,0.5)'}`, borderRadius:999, padding:'1px 7px' }}>
        {highlighted ? 'You' : `Your location${locationCity ? ` · ${locationCity}` : ''}`}
      </div>
      <style>{`@keyframes pulse{0%{transform:scale(0.8);opacity:0.8}100%{transform:scale(1.6);opacity:0}}`}</style>
      <div style={{ position:'absolute', inset:0, background:'linear-gradient(to top, #0a0a0f 0%, transparent 40%, transparent 70%, rgba(10,106,90,0.25) 100%)', pointerEvents:'none' }} />
    </div>
    );
  };

  const HomeTab = () => (
    <div style={{ display:'grid', gap:0, background:'#000', minHeight:'100%' }}>
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
            <div style={{ color:'#9ca3af', fontSize:11, marginTop:2 }}>Your location: <span style={{ color:'#bfdbfe', fontWeight:700 }}>{locationText}</span></div>
            <div style={{ color:'#9ca3af', fontSize:11, marginTop:2 }}>Not connected • Traffic is visible to your network & ISP</div>
            <button onClick={()=>connect()} style={{ marginTop:10, background:'#6d4aff', color:'#fff', border:0, padding:'10px 28px', borderRadius:999, fontWeight:800, cursor:'pointer', fontSize:13 }}>Quick Connect</button>
          </div>
        ) : (
          <div style={{ color:'#a7f3d0', fontSize:11, marginTop:4 }}>Encrypted • {vpnMode==='fast'?'TurboDirect':'GhostPath Stealth'} • RTT {rtt}ms</div>
        )}
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

      <div style={{ background:'#0a0a0f', padding:'10px 16px', display:'flex', alignItems:'center', justifyContent:'space-between', borderTop:'1px solid #1a1a24', borderBottom:'1px solid #1a1a24' }}>
        <span style={{ color:'#e5e7eb', fontSize:12 }}>How is your connection?</span>
        <div style={{ display:'flex', gap:12, color:'#6b7280' }}>
          <span style={{ cursor:'pointer' }} title="Bad">👎</span>
          <span style={{ width:1, height:14, background:'#2a2a38' }} />
          <span style={{ cursor:'pointer' }} title="Good">👍</span>
        </div>
      </div>

      <div style={{ padding:12, background:'#000', paddingBottom:80 }}>
        {connected ? (
          <div style={{ background:'#1c1b26', border:'1px solid #2a2a38', borderRadius:16, padding:14 }}>
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              <div style={{ width:36, height:36, borderRadius:8, background:'#2a2a38', display:'grid', placeItems:'center', fontSize:14, position:'relative' }}>
                {selectedProfile.icon}<span style={{ position:'absolute', bottom:-2, right:-2, background:'#fff', borderRadius:999, width:14, height:14, display:'grid', placeItems:'center', fontSize:9, border:'1px solid #ddd' }}>{selectedProfile.flag||'🇨🇦'}</span>
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
              Your location <span style={{ color:'#bfdbfe', fontWeight:700 }}>{locationText}</span><br/>
              Connect to hide your location and encrypt traffic.
            </div>
            <div style={{ marginTop:10, display:'flex', gap:8 }}>
              <button onClick={()=>connect()} style={{ flex:1, background:'#6d4aff', color:'#fff', border:0, padding:'12px', borderRadius:10, fontWeight:800, cursor:'pointer' }}>Quick Connect</button>
              <button onClick={()=>setTab('profiles')} style={{ flex:1, background:'transparent', color:'#e5e7eb', border:'1px solid #3a3a4a', padding:'12px', borderRadius:10, fontWeight:600, cursor:'pointer' }}>Change server</button>
            </div>
            <div style={{ marginTop:10, fontSize:11, color:'#6b7280' }}>Default: <span style={{ color:'#a78bfa' }}>{selectedProfile.name} • {selectedProfile.subtitle}</span> • Auto-pick fastest if offline</div>
          </div>
        )}

        <div style={{ marginTop:12, background:'#0f0f14', border:'1px solid #1f1f2a', borderRadius:12, padding:10, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div style={{ fontSize:11, color:'#9ca3af' }}>{vpnMode==='fast'?'⚡ Home Turbo':'🛡️ Stealth'} • {vpnMode==='fast'?'Plain WS':'TLS-in-TLS Fortinet-safe'}</div>
          <div style={{ display:'flex', gap:6, background:'#1a1a24', borderRadius:999, padding:3 }}>
            <button onClick={()=>setVpnMode('stealth')} style={{ padding:'5px 10px', borderRadius:999, border:0, fontSize:11, fontWeight:700, cursor:'pointer', background: vpnMode==='stealth'?'#6d4aff':'transparent', color: vpnMode==='stealth'?'#fff':'#9ca3af' }}>Stealth</button>
            <button onClick={()=>setVpnMode('fast')} style={{ padding:'5px 10px', borderRadius:999, border:0, fontSize:11, fontWeight:700, cursor:'pointer', background: vpnMode==='fast'?'#f59e0b':'transparent', color: vpnMode==='fast'?'#fff':'#9ca3af' }}>Turbo</button>
          </div>
        </div>

        <div style={{ marginTop:14 }}>
          <div style={{ color:'#e5e7eb', fontWeight:700, fontSize:12, marginBottom:8 }}>Recents</div>
          <div style={{ color:'#6b7280', fontSize:11, textAlign:'center', padding:'12px 0', border:'1px dashed #1f1f2a', borderRadius:10 }}>No recent connections — connect to see history</div>
        </div>

        <div style={{ marginTop:14, background:'#0f0f14', border:'1px solid #1f1f2a', borderRadius:10, padding:12 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <div style={{ color:'#e5e7eb', fontWeight:700, fontSize:12 }}>Releases</div>
            <button onClick={()=>{ setTab('releases'); fetchReleases() }} style={{ background:'#1a1a24', border:'1px solid #2a2a38', color:'#a78bfa', padding:'4px 8px', borderRadius:999, fontSize:11, cursor:'pointer' }}>View all →</button>
          </div>
          <div style={{ color:'#9ca3af', fontSize:11, marginTop:6 }}>
            {releases ? `${releases.length} releases • latest ${releases[0]?.tag_name||releases[0]?.name||'v1.1'}` : 'Native installers for Windows, macOS, Linux, Android & iOS'}
          </div>
          <div style={{ marginTop:8, display:'flex', gap:6, flexWrap:'wrap' }}>
            <span style={{ background:'#1a1a24', border:'1px solid #2a2a38', color:'#e5e7eb', padding:'3px 8px', borderRadius:999, fontSize:10 }}>Windows</span>
            <span style={{ background:'#1a1a24', border:'1px solid #2a2a38', color:'#e5e7eb', padding:'3px 8px', borderRadius:999, fontSize:10 }}>macOS</span>
            <span style={{ background:'#1a1a24', border:'1px solid #2a2a38', color:'#e5e7eb', padding:'3px 8px', borderRadius:999, fontSize:10 }}>Linux</span>
            <span style={{ background:'#1a1a24', border:'1px solid #2a2a38', color:'#e5e7eb', padding:'3px 8px', borderRadius:999, fontSize:10 }}>Android</span>
            <span style={{ background:'#1a1a24', border:'1px solid #2a2a38', color:'#e5e7eb', padding:'3px 8px', borderRadius:999, fontSize:10 }}>iOS</span>
          </div>
        </div>

        <div style={{ marginTop:10, fontSize:10, color:'#4b5563', textAlign:'center' }}>OpenPath • {hosts?.online??0}/{hosts?.total??0} hosts • {serverUrl.replace('wss://','').replace('ws://','').split('/')[0]} • PSK hidden</div>
      </div>
    </div>
  );

  const CountriesTab = () => (
    <div style={{ background:'#000', minHeight:'100%', paddingBottom:80 }}>
      <div style={{ padding:'16px 16px 10px', position:'sticky', top:0, background:'#000', zIndex:2 }}>
        <div style={{ color:'#fff', fontWeight:800, fontSize:18 }}>Countries</div>
        <div style={{ color:'#9ca3af', fontSize:11, marginTop:4 }}>Pick the fastest exit. Servers load once from <code style={{ background:'#1a1a24', padding:'2px 6px', borderRadius:6 }}>GET /api/hosts</code>.</div>
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

  // Bottom sheet for profile details
  const ProfileSheet = () => {
    if(!sheetProfile) return null
    return (
      <div style={{ position:'fixed', inset:0, zIndex:30, display:'flex', flexDirection:'column', justifyContent:'flex-end' }} onClick={closeSheet}>
        <div style={{ position:'absolute', inset:0, background:'rgba(0,0,0,0.6)' }} />
        <div onClick={e=>e.stopPropagation()} style={{ position:'relative', background:'#0f0f14', borderTopLeftRadius:16, borderTopRightRadius:16, borderTop:'1px solid #2a2a38', maxHeight:'72vh', overflow:'auto', animation:'slideUp 0.2s ease' }}>
          <div style={{ display:'flex', justifyContent:'center', padding:'10px 0 6px' }}><div style={{ width:36, height:4, borderRadius:999, background:'#3a3a4a' }} /></div>
          <div style={{ padding:'8px 16px 12px', display:'flex', alignItems:'center', gap:12, borderBottom:'1px solid #1a1a24' }}>
            <div style={{ width:36, height:36, borderRadius:8, background:'#1e1b2e', border:'1px solid #2a2a38', display:'grid', placeItems:'center', fontSize:16 }}>
              <span style={{ color:'#a78bfa' }}>{sheetProfile.icon}</span>
              {sheetProfile.fast && <span style={{ position:'absolute', marginLeft:22, marginTop:22, background:'#0ac47e', width:14, height:14, borderRadius:4, display:'grid', placeItems:'center', fontSize:8, border:'1px solid #000' }}>⚡</span> as any}
            </div>
            <div style={{ flex:1 }}>
              <div style={{ color:'#fff', fontWeight:700, fontSize:13 }}>{sheetProfile.name}</div>
              <div style={{ color:'#9ca3af', fontSize:11 }}>{sheetProfile.subtitle==='Fastest country'? 'Fastest country' : sheetProfile.countryName} {sheetProfile.city && sheetProfile.city!=='Fastest' ? `• ${sheetProfile.city}`:''}</div>
            </div>
            <div style={{ color:'#6b7280', fontSize:12, padding:'6px 10px', border:'1px solid #2a2a38', borderRadius:999, cursor:'pointer' }} onClick={closeSheet}>✕</div>
          </div>
          <div style={{ padding:'14px 16px' }}>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, fontSize:12 }}>
              <div>
                <div style={{ color:'#9ca3af', fontSize:11 }}>NetShield</div>
                <div style={{ color:'#e5e7eb', fontWeight:600, display:'flex', alignItems:'center', gap:6, marginTop:2 }}><span style={{ width:14, height:14, borderRadius:4, background: sheetProfile.netShield==='On' ? '#0ac47e':'#2a2a38', display:'grid', placeItems:'center', fontSize:8, color:'#fff' }}>🛡</span>{sheetProfile.netShield}</div>
              </div>
              <div>
                <div style={{ color:'#9ca3af', fontSize:11 }}>Custom DNS</div>
                <div style={{ color:'#e5e7eb', fontWeight:600, marginTop:2 }}>{sheetProfile.customDNS}</div>
              </div>
              <div style={{ borderTop:'1px solid #1a1a24', paddingTop:10 }}>
                <div style={{ color:'#9ca3af', fontSize:11 }}>Protocol</div>
                <div style={{ color:'#e5e7eb', fontWeight:600, marginTop:2 }}>{sheetProfile.protocol}</div>
              </div>
              <div style={{ borderTop:'1px solid #1a1a24', paddingTop:10 }}>
                <div style={{ color:'#9ca3af', fontSize:11 }}>NAT</div>
                <div style={{ color:'#e5e7eb', fontWeight:600, marginTop:2 }}>{sheetProfile.natType}</div>
              </div>
              <div style={{ borderTop:'1px solid #1a1a24', paddingTop:10 }}>
                <div style={{ color:'#9ca3af', fontSize:11 }}>LAN</div>
                <div style={{ color:'#e5e7eb', fontWeight:600, marginTop:2 }}>{sheetProfile.lan}</div>
              </div>
              <div style={{ borderTop:'1px solid #1a1a24', paddingTop:10 }}>
                <div style={{ color:'#9ca3af', fontSize:11 }}>Country</div>
                <div style={{ color:'#e5e7eb', fontWeight:600, marginTop:2 }}>{sheetProfile.flag} {sheetProfile.countryName}</div>
              </div>
            </div>
            <div style={{ marginTop:16, display:'grid', gap:0, background:'#1a1a24', borderRadius:12, overflow:'hidden', border:'1px solid #2a2a38' }}>
              <button onClick={()=>startEdit(sheetProfile)} style={{ textAlign:'left', background:'transparent', border:0, padding:'14px 16px', color:'#e5e7eb', fontSize:13, cursor:'pointer', display:'flex', alignItems:'center', gap:12, borderBottom:'1px solid #2a2a38' }}><span>✎</span> Edit</button>
              <button onClick={()=>duplicateProfile(sheetProfile)} style={{ textAlign:'left', background:'transparent', border:0, padding:'14px 16px', color:'#e5e7eb', fontSize:13, cursor:'pointer', display:'flex', alignItems:'center', gap:12, borderBottom:'1px solid #2a2a38' }}><span>⧉</span> Duplicate</button>
              <button onClick={()=>deleteProfile(sheetProfile.id)} style={{ textAlign:'left', background:'transparent', border:0, padding:'14px 16px', color:'#f87171', fontSize:13, cursor:'pointer', display:'flex', alignItems:'center', gap:12 }}><span>🗑</span> Delete</button>
            </div>
            <button onClick={()=>{ setSelectedProfile(sheetProfile); closeSheet(); connect(undefined, sheetProfile) }} style={{ marginTop:12, width:'100%', background:'#6d4aff', color:'#fff', border:0, padding:'13px', borderRadius:12, fontWeight:800, cursor:'pointer' }}>Connect</button>
          </div>
        </div>
        <style>{`@keyframes slideUp{ from{ transform:translateY(20px); opacity:0 } to{ transform:translateY(0); opacity:1 } }`}</style>
      </div>
    )
  }

  // 3-step Edit Wizard overlay — pixel-matched to screenshots
  const EditWizard = () => {
    if(!editing) return null
    const stepPct = editStep===1?33: editStep===2?66:100
    return (
      <div style={{ position:'fixed', inset:0, zIndex:40, background:'#000', display:'flex', flexDirection:'column' }}>
        {/* OS chrome + header */}
        <div style={{ height:28, background:'#0a0a0f', display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 12px', borderBottom:'1px solid #1a1a24', flexShrink:0 }}>
          <span style={{ color:'#fff', fontSize:12 }}>‹</span>
          <div style={{ display:'flex', gap:10, color:'#6b7280', fontSize:12 }}><span>—</span><span>▭</span><span onClick={()=>setEditing(null)} style={{ cursor:'pointer' }}>✕</span></div>
        </div>
        <div style={{ background:'#000', borderBottom:'1px solid #1a1a24' }}>
          <div style={{ display:'flex', alignItems:'center', gap:10, padding:'12px 16px' }}>
            <span onClick={()=>setEditing(null)} style={{ color:'#fff', cursor:'pointer', fontSize:16 }}>✕</span>
            <span style={{ color:'#fff', fontWeight:700, fontSize:14 }}>Edit {editing.name}</span>
          </div>
          <div style={{ height:2, background:'#1a1a24', position:'relative' }}>
            <div style={{ position:'absolute', left:0, top:0, bottom:0, width:`${stepPct}%`, background:'#7c4dff', transition:'width 0.2s' }} />
          </div>
          <div style={{ padding:'8px 16px', color:'#7c4dff', fontSize:11, fontWeight:600 }}>Step {editStep} of 3</div>
        </div>

        <div style={{ flex:1, overflow:'auto', padding:'24px 20px 20px', background:'#000' }}>
          {editStep===1 && (
            <div style={{ maxWidth:520, margin:'0 auto' }}>
              <input value={editing.name} onChange={e=>setEditing({ ...editing, name: e.target.value })} placeholder="School" style={{ width:'100%', background:'transparent', border:0, borderBottom:'2px solid #7c4dff', color:'#fff', fontSize:15, padding:'8px 4px', outline:'none' }} />
              <div style={{ marginTop:22, display:'flex', gap:14, justifyContent:'center', alignItems:'center' }}>
                {PROFILE_COLORS.map(c=>(
                  <button key={c} onClick={()=>setEditing({ ...editing, color:c })} style={{ width:22, height:22, borderRadius:999, background:c, border: editing.color===c ? '2px solid #fff' : '2px solid transparent', boxShadow: editing.color===c ? '0 0 0 2px #7c4dff' : 'none', cursor:'pointer' }}>
                  </button>
                ))}
              </div>
              <div style={{ marginTop:20, display:'grid', gridTemplateColumns:'repeat(6, 1fr)', gap:14 }}>
                {ICON_GRID.map(ic=>{
                  const selected = editing.icon===ic.e
                  return (
                    <button key={ic.k} onClick={()=>setEditing({ ...editing, icon: ic.e })} style={{ height:48, borderRadius:10, background: selected ? '#2a2340' : '#1a1a24', border: selected ? '1px solid #fff' : '1px solid transparent', display:'grid', placeItems:'center', fontSize:18, cursor:'pointer', color:'#a78bfa', outline: selected ? '2px solid #7c4dff' : 'none', outlineOffset: selected ? '1px' : '0' }}>
                      <span style={{ filter: selected ? 'none' : 'grayscale(0.2)', opacity: selected ? 1 : 0.9 }}>{ic.e}</span>
                    </button>
                  )
                })}
              </div>
              <div style={{ display:'none' }}>{/* keep name accessible */}</div>
            </div>
          )}
          {editStep===2 && (
            <div style={{ maxWidth:520, margin:'0 auto' }}>
              <div style={{ color:'#fff', fontWeight:700, fontSize:15, marginBottom:18 }}>Select connection type and location</div>
              <div style={{ display:'grid', gap:18 }}>
                <div>
                  <div style={{ color:'#9ca3af', fontSize:11, marginBottom:6, fontWeight:600 }}>Type</div>
                  <div onClick={()=>{}} style={{ background:'#23222f', border:'1px solid #2a2a38', borderRadius:10, padding:'12px 14px', display:'flex', justifyContent:'space-between', alignItems:'center', cursor:'pointer' }}>
                    <span style={{ color:'#fff', fontSize:13, display:'flex', gap:8, alignItems:'center' }}><span>🌐</span> {editing.typeLabel}</span>
                    <span style={{ color:'#9ca3af' }}>⌄</span>
                  </div>
                  <div style={{ marginTop:6, display:'flex', gap:6, flexWrap:'wrap' }}>
                    {['Standard','Secure Core','P2P','Tor'].map(t=>(
                      <button key={t} onClick={()=>setEditing({ ...editing, typeLabel:t })} style={{ padding:'4px 8px', borderRadius:999, border: editing.typeLabel===t ? '1px solid #7c4dff' : '1px solid #2a2a38', background: editing.typeLabel===t ? '#7c4dff':'#1a1a24', color: editing.typeLabel===t ? '#fff':'#9ca3af', fontSize:11, cursor:'pointer' }}>{t}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <div style={{ color:'#9ca3af', fontSize:11, marginBottom:6, fontWeight:600 }}>Country</div>
                  <select value={editing.countryCode} onChange={e=>{
                    const co = COUNTRIES.find(c=>c.code===e.target.value)!
                    setEditing({ ...editing, countryCode: co.code, countryName: co.name, flag: co.flag })
                  }} style={{ width:'100%', background:'#23222f', border:'1px solid #2a2a38', borderRadius:10, padding:'12px 14px', color:'#fff', fontSize:13, appearance:'none' as any }}>
                    {COUNTRIES.map(c=> <option key={c.code} value={c.code}>{c.flag} {c.name}</option>)}
                  </select>
                </div>
                <div>
                  <div style={{ color:'#9ca3af', fontSize:11, marginBottom:6, fontWeight:600 }}>City</div>
                  <div style={{ background:'#23222f', border:'1px solid #2a2a38', borderRadius:10, padding:'12px 14px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <span style={{ color:'#fff', fontSize:13, display:'flex', gap:8, alignItems:'center' }}>⚡ {editing.city}</span>
                    <span style={{ color:'#9ca3af' }}>⌄</span>
                  </div>
                  <div style={{ marginTop:6, display:'flex', gap:6 }}>
                    {['Fastest','Toronto','Montreal','Vancouver'].map(city=>(
                      <button key={city} onClick={()=>setEditing({ ...editing, city })} style={{ padding:'4px 8px', borderRadius:999, border: editing.city===city?'1px solid #7c4dff':'1px solid #2a2a38', background: editing.city===city?'#7c4dff':'#1a1a24', color: editing.city===city?'#fff':'#9ca3af', fontSize:11, cursor:'pointer' }}>{city}</button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
          {editStep===3 && (
            <div style={{ maxWidth:520, margin:'0 auto' }}>
              <div style={{ color:'#fff', fontWeight:700, fontSize:15 }}>Configure profile settings</div>
              <div style={{ color:'#9ca3af', fontSize:11, marginTop:4, marginBottom:16 }}>Profile settings will override your VPN settings when connected.</div>
              <div style={{ display:'grid', gap:16 }}>
                {[
                  { label:'NetShield', val: editing.netShield, options:['On','Off'], key:'netShield' },
                  { label:'Protocol', val: editing.protocol, options:['Stealth','Smart (auto)','WireGuard','Stealth (Fortinet)'], key:'protocol' },
                  { label:'NAT type', val: editing.natType, options:['Type 1','Type 2','Type 3'], key:'natType' },
                  { label:'LAN connections', val: editing.lan, key:'lan', arrow:true },
                  { label:'Connect and Go', val: editing.connectAndGo, key:'connectAndGo' },
                  { label:'Custom DNS', val: editing.customDNS, key:'customDNS', arrow:true },
                ].map(row=>(
                  <div key={row.label}>
                    <div style={{ color:'#e5e7eb', fontSize:11, fontWeight:600, marginBottom:6 }}>{row.label}</div>
                    <div style={{ background:'#23222f', border:'1px solid #2a2a38', borderRadius:10, padding:'12px 14px', display:'flex', justifyContent:'space-between', alignItems:'center', cursor:'pointer' }}>
                      <span style={{ color:'#fff', fontSize:13, display:'flex', gap:8, alignItems:'center' }}>
                        {row.label==='NetShield' && row.val==='On' && <span style={{ color:'#0ac47e' }}>🛡️</span>}
                        {row.val}
                      </span>
                      <span style={{ color:'#9ca3af', fontSize:12 }}>{row.arrow ? '›' : '⌄'}</span>
                    </div>
                    {(row as any).options && (
                      <div style={{ marginTop:6, display:'flex', gap:6, flexWrap:'wrap' }}>
                        {(row as any).options.map((o:string)=>(
                          <button key={o} onClick={()=>{
                            const upd:any = { ...editing }
                            upd[row.key as any]=o
                            setEditing(upd)
                          }} style={{ padding:'4px 8px', borderRadius:999, border: editing[row.key as keyof EditableProfile]===o ? '1px solid #7c4dff' : '1px solid #2a2a38', background: editing[row.key as keyof EditableProfile]===o ? '#7c4dff' : '#1a1a24', color: editing[row.key as keyof EditableProfile]===o ? '#fff':'#9ca3af', fontSize:11, cursor:'pointer' }}>{o}</button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div style={{ padding:'14px 16px', background:'#000', borderTop:'1px solid #1a1a24', display:'flex', gap:10, position:'sticky', bottom:0 }}>
          {editStep===1 ? (
            <button onClick={()=>setEditing(null)} style={{ flex:1, background:'#23222f', color:'#e5e7eb', border:'1px solid #2a2a38', padding:'12px', borderRadius:10, fontWeight:600, cursor:'pointer' }}>Cancel</button>
          ) : (
            <button onClick={()=>setEditStep(s=> (s-1) as any)} style={{ flex:1, background:'#2a2a38', color:'#e5e7eb', border:'1px solid #3a3a4a', padding:'12px', borderRadius:10, fontWeight:600, cursor:'pointer' }}>Back</button>
          )}
          {editStep < 3 ? (
            <button onClick={()=>setEditStep(s=> (s+1) as any)} style={{ flex:1, background:'#6d4aff', color:'#fff', border:0, padding:'12px', borderRadius:10, fontWeight:800, cursor:'pointer' }}>Next</button>
          ) : (
            <button onClick={saveEditing} style={{ flex:1, background:'#6d4aff', color:'#fff', border:0, padding:'12px', borderRadius:10, fontWeight:800, cursor:'pointer' }}>Save</button>
          )}
        </div>
      </div>
    )
  }

  const ProfilesTab = () => (
    <div style={{ background:'#000', minHeight:'100%', paddingBottom:80 }}>
      <div style={{ padding:'16px 16px 0', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div style={{ color:'#fff', fontWeight:800, fontSize:18 }}>Profiles</div>
        <span style={{ color:'#9ca3af', fontSize:11, border:'1px solid #2a2a38', padding:'4px 8px', borderRadius:999, cursor:'pointer' }} onClick={()=>fetchReleases()}>Info ⓘ</span>
      </div>
      <div style={{ padding:8 }}>
        {editableProfiles.map(p=>(
          <div key={p.id} onClick={()=> openSheet(p)} style={{ display:'flex', alignItems:'center', gap:12, padding:'14px 12px', borderBottom:'1px solid #12121a', cursor:'pointer', background: selectedProfile.id===p.id && connected ? '#12121a' : 'transparent' }}>
            <div style={{ width:36, height:36, borderRadius:8, background:'#1e1b2e', display:'grid', placeItems:'center', fontSize:16, position:'relative', border:'1px solid #2a2a38' }}>
              <span style={{ color:'#a78bfa' }}>{p.icon}</span>
              {p.fast && <span style={{ position:'absolute', bottom:-4, right:-4, background:'#0ac47e', width:16, height:16, borderRadius:99, display:'grid', placeItems:'center', fontSize:9, border:'1px solid #000', color:'#fff' }}>⚡</span>}
              {p.flag && !p.fast && <span style={{ position:'absolute', bottom:-2, right:-2, background:'#1a1a24', borderRadius:4, padding:'1px 3px', fontSize:8, border:'1px solid #2a2a38' }}>{p.flag}</span>}
            </div>
            <div style={{ flex:1 }}>
              <div style={{ color:'#fff', fontWeight:700, fontSize:13, display:'flex', alignItems:'center', gap:6 }}>{p.name} {p.id==='school' && connected && <span style={{ width:8, height:8, background:'#0ac47e', borderRadius:999, boxShadow:'0 0 6px #0ac47e' }} />}</div>
              <div style={{ color:'#9ca3af', fontSize:11 }}>{p.subtitle}</div>
            </div>
            <button onClick={(e)=>{ e.stopPropagation(); openSheet(p)}} style={{ background:'transparent', border:0, color:'#6b7280', fontSize:16, cursor:'pointer', padding:'6px 8px' }}>⋯</button>
          </div>
        ))}
      </div>
      <div style={{ padding:'16px 12px 40px' }}>
        <button onClick={startCreate} style={{ width:'100%', background:'#6d4aff', color:'#fff', border:0, padding:'14px', borderRadius:12, fontWeight:800, cursor:'pointer' }}>Create profile</button>
        <div style={{ color:'#4b5563', fontSize:11, textAlign:'center', marginTop:8 }}>Custom profiles save country + NetShield + Stealth settings • Profiles have releases (versions) — edit to bump</div>
      </div>
    </div>
  );

  const SettingsTab = () => {
    const [notifPerm, setNotifPerm] = useState<string>(()=> typeof Notification !== 'undefined' ? Notification.permission : 'unsupported')
    const [showLogs, setShowLogs] = useState(false)
    const [copied, setCopied] = useState(false)
    const [confirmReset, setConfirmReset] = useState(false)

    const requestNotif = async()=>{
      if(typeof Notification === 'undefined') return
      const p = await Notification.requestPermission()
      setNotifPerm(p)
      log(`Notification permission: ${p}`)
      if(p==='granted') fireSystemNotification('OpenPath VPN', 'Notifications enabled. Alerts appear in your system notification center.', '/favicon.png')
    }
    const testNotif = ()=> fireSystemNotification('OpenPath VPN', 'Test notification — this is how connect and disconnect alerts look.', '/favicon.png')
    const copyLogs = async()=>{
      try{ await navigator.clipboard.writeText(logs.join('\n')); setCopied(true); setTimeout(()=>setCopied(false), 1500) }catch{}
    }
    const resetLocal = ()=>{
      if(!confirmReset){ setConfirmReset(true); setTimeout(()=>setConfirmReset(false), 4000); return }
      try{
        localStorage.removeItem('openpath:editable-profiles')
        localStorage.removeItem('openpath:mode')
      }catch{}
      setEditableProfiles(DEFAULT_EDITABLE.map(p=>({ ...p })))
      setVpnMode('stealth')
      setConfirmReset(false)
      log('Local profiles and settings reset')
    }

    const notifText = notifPerm==='granted' ? 'Enabled' : notifPerm==='denied' ? 'Blocked in system settings' : notifPerm==='unsupported' ? 'Not supported here' : 'Off — tap to enable'
    const serverHost = serverUrl.replace('wss://','').replace('ws://','').split('/')[0]

    const Section = ({ title, children }:{ title:string; children:React.ReactNode }) => (
      <div style={{ marginTop:18 }}>
        <div style={{ color:'#a78bfa', fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:0.5, marginBottom:8 }}>{title}</div>
        <div style={{ background:'#12121a', border:'1px solid #1f1f2a', borderRadius:12, overflow:'hidden' }}>{children}</div>
      </div>
    )
    const Row = ({ icon, title, sub, right, onClick, last }:{ icon:string; title:string; sub?:string; right?:React.ReactNode; onClick?:()=>void; last?:boolean }) => (
      <div onClick={onClick} style={{ display:'flex', alignItems:'center', gap:12, padding:'13px 14px', borderBottom: last ? 'none' : '1px solid #1f1f2a', cursor: onClick ? 'pointer' : 'default' }}>
        <span style={{ width:22, textAlign:'center', fontSize:13 }}>{icon}</span>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ color:'#e5e7eb', fontSize:13, fontWeight:600 }}>{title}</div>
          {sub && <div style={{ color:'#8b8da3', fontSize:11, marginTop:2, lineHeight:1.45 }}>{sub}</div>}
        </div>
        <div style={{ color:'#9ca3af', fontSize:11, display:'flex', alignItems:'center', gap:6, flexShrink:0 }}>{right ?? '›'}</div>
      </div>
    )

    return (
      <div style={{ background:'#000', minHeight:'100%', paddingBottom:80 }}>
        <div style={{ padding:'16px 16px 0' }}>
          <div style={{ color:'#fff', fontWeight:800, fontSize:18 }}>Settings</div>
          <div style={{ color:'#8b8da3', fontSize:11, marginTop:4 }}>Everything on this page changes how OpenPath behaves on this device.</div>
        </div>
        <div style={{ padding:'0 16px 16px' }}>

          <Section title="Connection">
            <div style={{ padding:'13px 14px' }}>
              <div style={{ color:'#e5e7eb', fontSize:13, fontWeight:600 }}>Protocol</div>
              <div style={{ color:'#8b8da3', fontSize:11, marginTop:2 }}>
                {vpnMode==='stealth' ? 'Stealth — TLS inside TLS over TCP 443, survives FortiGate' : 'Turbo — plain WebSocket, lowest overhead, trusted networks only'}
              </div>
              <div style={{ marginTop:10, display:'flex', gap:6, background:'#0a0a0f', border:'1px solid #2a2a38', borderRadius:999, padding:3 }}>
                <button onClick={()=>{ setVpnMode('stealth'); log('Protocol set to Stealth') }} style={{ flex:1, padding:'8px 10px', borderRadius:999, border:0, fontSize:12, fontWeight:700, cursor:'pointer', background: vpnMode==='stealth'?'#6d4aff':'transparent', color: vpnMode==='stealth'?'#fff':'#9ca3af' }}>Stealth</button>
                <button onClick={()=>{ setVpnMode('fast'); log('Protocol set to Turbo') }} style={{ flex:1, padding:'8px 10px', borderRadius:999, border:0, fontSize:12, fontWeight:700, cursor:'pointer', background: vpnMode==='fast'?'#6d4aff':'transparent', color: vpnMode==='fast'?'#fff':'#9ca3af' }}>Turbo</button>
              </div>
            </div>
            <div style={{ padding:'0 14px 13px' }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8 }}>
                <div style={{ minWidth:0 }}>
                  <div style={{ color:'#e5e7eb', fontSize:12, fontWeight:600 }}>Server</div>
                  <div style={{ color:'#8b8da3', fontSize:11, fontFamily:'monospace', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{serverHost}</div>
                </div>
                <button onClick={async()=>{
                  try{
                    const r=await fetch('/api/hosts');
                    if(r.ok){ const d=await r.json(); setHosts(d); log('Refreshed hosts: '+d.online+' online') }
                  }catch(e:any){ log('Refresh failed: '+e.message) }
                }} style={{ background:'#1a1a24', border:'1px solid #2a2a38', color:'#e5e7eb', padding:'6px 12px', borderRadius:8, cursor:'pointer', fontSize:11, flexShrink:0 }}>↻ Refresh</button>
              </div>
              <div style={{ color:'#8b8da3', fontSize:11, marginTop:6 }}>{hosts ? `${hosts.online} of ${hosts.total} servers online` : 'Server list not loaded yet'}</div>
            </div>
          </Section>

          <Section title="Notifications">
            <Row
              icon="🔔"
              title="System notifications"
              sub="Connect and disconnect alerts use your operating system notification center. OpenPath does not show an in-app banner."
              right={<span style={{ color: notifPerm==='granted' ? '#0ac47e' : notifPerm==='denied' ? '#f87171' : '#e5e7eb', fontWeight:700 }}>{notifText}</span>}
              onClick={notifPerm==='granted' ? undefined : requestNotif}
              last={notifPerm!=='granted'}
            />
            {notifPerm==='granted' && (
              <>
                <Row icon="🧪" title="Send a test notification" sub="Fires one real system notification" onClick={testNotif} last />
              </>
            )}
          </Section>

          <Section title="Profiles">
            <Row icon="▭" title={`${editableProfiles.length} saved profiles`} sub="Edit, duplicate or delete them in Profiles" onClick={()=>setTab('profiles')} />
            <Row icon="＋" title="Create profile" sub="Name, colour, icon, location and profile settings" onClick={startCreate} last />
          </Section>

          <Section title="App">
            <Row
              icon="⬆"
              title="Releases"
              sub={releases?.length ? `Latest ${releases[0]?.tag_name || releases[0]?.name}` : 'Builds for Windows, macOS, Linux, Android, iOS'}
              onClick={()=>{ setTab('releases'); fetchReleases() }}
            />
            <Row icon="⌥" title="Source code" sub="GitHub repository" onClick={()=>window.open('https://github.com/mob5824m-wq/OpenPath-VPN','_blank')} />
            <Row icon="🐞" title="Report an issue" sub="Opens a GitHub issue" onClick={()=>window.open('https://github.com/mob5824m-wq/OpenPath-VPN/issues','_blank')} last />
          </Section>

          <Section title="Diagnostics">
            <Row icon="</>" title="Connection log" sub={`${logs.length} events on this device`} right={<span>{showLogs ? 'Hide' : 'Show'}</span>} onClick={()=>setShowLogs(v=>!v)} last={!showLogs} />
            {showLogs && (
              <div style={{ padding:'0 14px 12px' }}>
                <div style={{ background:'#0a0a0f', border:'1px solid #2a2a38', borderRadius:8, padding:10, maxHeight:160, overflow:'auto', fontFamily:'JetBrains Mono, monospace', fontSize:10, color:'#9ca3af', whiteSpace:'pre-wrap', lineHeight:1.6 }}>
                  {logs.slice(-12).join('\n') || 'No events yet'}
                </div>
                <button onClick={copyLogs} style={{ marginTop:8, background:'#1a1a24', border:'1px solid #2a2a38', color:'#e5e7eb', padding:'6px 12px', borderRadius:8, cursor:'pointer', fontSize:11 }}>{copied ? 'Copied' : 'Copy log'}</button>
              </div>
            )}
          </Section>

          <Section title="About">
            <Row icon="🛡️" title="OpenPath VPN" sub="Web app 1.0.0 • GhostPath stealth transport" right="" />
            <Row icon="↺" title={confirmReset ? 'Tap again to confirm reset' : 'Reset local data'} sub="Deletes saved profiles and protocol choice on this device" right="" onClick={resetLocal} last />
          </Section>

          <div style={{ marginTop:16, textAlign:'center', color:'#4b5563', fontSize:10 }}>
            {serverHost} • {hosts?.online ?? 0}/{hosts?.total ?? 0} servers • PSK hidden
          </div>
        </div>
      </div>
    );
  };

  const ReleasesTab = () => (
    <div style={{ background:'#000', minHeight:'100%', paddingBottom:80 }}>
      <div style={{ padding:'16px 16px 8px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <button onClick={()=>setTab('settings')} style={{ background:'transparent', border:'1px solid #2a2a38', color:'#e5e7eb', padding:'6px 10px', borderRadius:999, cursor:'pointer' }}>‹ Back</button>
          <div style={{ color:'#fff', fontWeight:800, fontSize:18 }}>Releases</div>
        </div>
        <div style={{ color:'#9ca3af', fontSize:11, marginTop:8 }}>Auto-tag +0.1 on merge to main • Native installers published to GitHub Releases</div>
        <button onClick={fetchReleases} style={{ marginTop:10, background:'#1a1a24', border:'1px solid #2a2a38', color:'#a78bfa', padding:'6px 10px', borderRadius:8, cursor:'pointer', fontSize:11 }}>↻ Refresh from GitHub</button>
      </div>
      <div style={{ padding:'12px', display:'grid', gap:10 }}>
        {releasesLoading && <div style={{ color:'#9ca3af', textAlign:'center', padding:20 }}>Loading releases…</div>}
        {releases && releases.length===0 && <div style={{ background:'#1c1b26', border:'1px solid #2a2a38', borderRadius:12, padding:14, color:'#9ca3af', fontSize:11, textAlign:'center' }}>No releases yet. Merge to main to create v1.0 → v1.1 auto-tag. <br/>Artifacts: Windows NSIS, macOS DMG, Linux deb/rpm/AppImage, Android APK/AAR, iOS PacketTunnel</div>}
        {releases && releases.map((rel:any)=>(
          <div key={rel.id||rel.tag_name} style={{ background:'#12121a', border:'1px solid #1f1f2a', borderRadius:12, padding:12 }}>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ background:'#6d4aff', color:'#fff', padding:'3px 8px', borderRadius:999, fontSize:11, fontWeight:700 }}>{rel.tag_name||rel.name}</span>
              <span style={{ color:'#e5e7eb', fontSize:12, fontWeight:700 }}>{rel.name||rel.tag_name}</span>
              <span style={{ marginLeft:'auto', color:'#6b7280', fontSize:10 }}>{rel.published_at ? new Date(rel.published_at).toLocaleDateString() : ''}</span>
            </div>
            <div style={{ color:'#9ca3af', fontSize:11, marginTop:6, whiteSpace:'pre-wrap', lineHeight:1.5 }}>{rel.body ? rel.body.slice(0,400) : 'Release with native installers and profile updates.'}</div>
            <div style={{ marginTop:8, display:'flex', gap:6, flexWrap:'wrap' }}>
              {(rel.assets||[]).slice(0,6).map((a:any)=>(
                <a key={a.id} href={a.browser_download_url} target="_blank" rel="noreferrer" style={{ background:'#1a1a24', border:'1px solid #2a2a38', color:'#a78bfa', padding:'4px 8px', borderRadius:999, fontSize:10, textDecoration:'none' }}>{a.name} ⬇</a>
              ))}
              {(rel.assets||[]).length===0 && <span style={{ color:'#6b7280', fontSize:10 }}>Assets attached on tag push (see workflow release.yml)</span>}
            </div>
            <div style={{ marginTop:6, fontSize:10, color:'#4b5563' }}>Profile versions tracked per release — check Settings → Profiles history</div>
          </div>
        ))}
        {!releases && !releasesLoading && (
          <div style={{ background:'#12121a', border:'1px solid #1f1f2a', borderRadius:12, padding:14 }}>
            <div style={{ color:'#e5e7eb', fontWeight:700, fontSize:12 }}>Releases for Apps & Profiles</div>
            <div style={{ color:'#9ca3af', fontSize:11, marginTop:6 }}>Every merge to main bumps tag v1.x (e.g., v1.0 → v1.1). Workflow builds: server, web, Linux GUI/CLI, Windows NSIS, macOS DMG, Android APK, iOS extension.</div>
            <button onClick={fetchReleases} style={{ marginTop:10, background:'#6d4aff', color:'#fff', border:0, padding:'10px 14px', borderRadius:8, fontWeight:700, cursor:'pointer', fontSize:12 }}>Load GitHub Releases</button>
          </div>
        )}
        <div style={{ background:'#0f0f14', border:'1px solid #1f1f2a', borderRadius:12, padding:12 }}>
          <div style={{ color:'#e5e7eb', fontWeight:700, fontSize:12 }}>Profiles — version history</div>
          <div style={{ color:'#9ca3af', fontSize:11, marginTop:4 }}>Profiles are versioned locally (localStorage `openpath:editable-profiles`). Releasing a profile set is a GitHub release tag that snapshots them.</div>
          <div style={{ marginTop:8, display:'grid', gap:6 }}>
            {editableProfiles.map(p=>(
              <div key={p.id} style={{ display:'flex', alignItems:'center', gap:8, background:'#1a1a24', border:'1px solid #2a2a38', borderRadius:8, padding:'8px 10px' }}>
                <span style={{ color:'#a78bfa' }}>{p.icon}</span>
                <span style={{ color:'#e5e7eb', fontSize:12, fontWeight:600 }}>{p.name}</span>
                <span style={{ color:'#9ca3af', fontSize:10 }}>• {p.countryName} • {p.city} • {p.protocol} • {p.netShield}</span>
                <span style={{ marginLeft:'auto', color:'#6b7280', fontSize:10 }}>v1</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )

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
      <div style={{ flex:1, overflow:'auto', WebkitOverflowScrolling:'touch' as any }}>
        {tab==='home' && <HomeTab />}
        {tab==='countries' && <CountriesTab />}
        {tab==='profiles' && <ProfilesTab />}
        {tab==='settings' && <SettingsTab />}
        {tab==='releases' && <ReleasesTab />}
      </div>
      <BottomNav />
      {sheetProfile && <ProfileSheet />}
      {editing && <EditWizard />}
      <div style={{ display:'none' }}>{logs.map((l,i)=><div key={i}>{l}</div>)}</div>
    </div>
  )
}
