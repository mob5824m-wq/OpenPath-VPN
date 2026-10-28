import React, { useEffect, useRef, useState } from 'react'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type Tab = 'home' | 'countries' | 'profiles' | 'settings' | 'releases'
type Mode = 'stealth' | 'fast'

type HostEntry = { id:string; name:string; host:string; port:number; wssUrl:string; duckdnsUrl?:string; region:string; country:string; flag:string; load:number; online:boolean; latencyMs?:number }
type ProfileRow = { id:string; name:string; subtitle:string; icon:string; color:string; flag?:string; fast?:boolean; connected?:boolean }

type EditableProfile = ProfileRow & {
  typeLabel: string
  countryCode: string
  countryName: string
  city: string
  netShield: 'On'|'Off'
  protocol: 'Stealth'|'Smart (auto)'|'WireGuard'|'Stealth (Fortinet)'
  natType: 'Type 1'|'Type 2'|'Type 3'
  lan: 'On'|'Off'
  connectAndGo: 'On'|'Off'
  customDNS: 'On'|'Off'
  customDNSVal?: string
}

type GeoPoint = { lat:number; lon:number; city:string; country:string; source:'ip'|'gps'|'default' }
type RecentEntry = { profileId:string; name:string; flag:string; city:string; country:string; mode:Mode; at:number }
type ShieldMode = 'Off' | 'Block malware' | 'Block malware, ads & trackers'
type MenuOption = { value:string; label:string; icon?:string }

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const PROFILE_COLORS = ['#7c4dff','#3b82f6','#10b981','#ef4444','#fb923c','#eab308']
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

const FALLBACK_LOCATION: GeoPoint = { lat:45.5019, lon:-73.5674, city:'Montréal', country:'Canada', source:'default' }

const PROFILE_TYPES = ['Standard','Secure Core','P2P','Tor']
const PROTOCOL_OPTIONS: EditableProfile['protocol'][] = ['Stealth','Smart (auto)','WireGuard','Stealth (Fortinet)']
const NAT_OPTIONS: EditableProfile['natType'][] = ['Type 1','Type 2','Type 3']
const ON_OFF: ('On'|'Off')[] = ['On','Off']
const SHIELD_OPTIONS: ShieldMode[] = ['Off','Block malware','Block malware, ads & trackers']

const PLATFORM_FILTERS: { id:string; label:string; match:(name:string)=>boolean }[] = [
  { id:'all', label:'All', match:()=>true },
  { id:'windows', label:'Windows', match:n=>/(\.exe|\.msi|nsis|win)/i.test(n) },
  { id:'macos', label:'macOS', match:n=>/(\.dmg|\.pkg|mac|darwin)/i.test(n) },
  { id:'linux', label:'Linux', match:n=>/(\.deb|\.rpm|\.appimage|linux)/i.test(n) },
  { id:'android', label:'Android', match:n=>/(\.apk|\.aar|android)/i.test(n) },
  { id:'ios', label:'iOS', match:n=>/(\.ipa|ios|packettunnel)/i.test(n) },
]

/* ------------------------------------------------------------------ */
/*  Storage helpers                                                    */
/* ------------------------------------------------------------------ */

function readJSON<T>(key:string, fallback:T):T {
  try {
    const raw = localStorage.getItem(key)
    if(raw) return JSON.parse(raw) as T
  } catch {}
  return fallback
}
function writeJSON(key:string, value:unknown){
  try { localStorage.setItem(key, JSON.stringify(value)) } catch {}
}

function loadEditable(): EditableProfile[] {
  try {
    const raw = localStorage.getItem('openpath:editable-profiles')
    if(raw){
      const arr = JSON.parse(raw) as EditableProfile[]
      const byId = new Map(arr.map(p=>[p.id,p]))
      const merged = DEFAULT_EDITABLE.map(d=> byId.get(d.id) ? { ...d, ...byId.get(d.id)! } : d)
      for(const p of arr) if(!merged.find(m=>m.id===p.id)) merged.push(p)
      return merged
    }
  } catch {}
  return DEFAULT_EDITABLE.map(p=>({ ...p }))
}
function saveEditable(profiles: EditableProfile[]){ writeJSON('openpath:editable-profiles', profiles) }

/* ------------------------------------------------------------------ */
/*  Formatting / geo helpers                                           */
/* ------------------------------------------------------------------ */

function fmtBytes(n:number){
  if(!n) return '0 B'
  if(n < 1024) return `${n} B`
  if(n < 1024*1024) return `${(n/1024).toFixed(1)} KB`
  if(n < 1024*1024*1024) return `${(n/1024/1024).toFixed(1)} MB`
  return `${(n/1024/1024/1024).toFixed(2)} GB`
}
function fmtDuration(ms:number){
  if(ms <= 0) return '0s'
  const s = Math.floor(ms/1000)
  const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = s%60
  if(h) return `${h}h ${String(m).padStart(2,'0')}m`
  if(m) return `${m}m ${String(sec).padStart(2,'0')}s`
  return `${sec}s`
}
function ago(ts:number){
  const mins = Math.floor((Date.now()-ts)/60000)
  if(mins < 1) return 'just now'
  if(mins < 60) return `${mins}m ago`
  const h = Math.floor(mins/60)
  if(h < 24) return `${h}h ago`
  return `${Math.floor(h/24)}d ago`
}
function projectPoint(lat:number, lon:number){ return { x: ((lon+180)/360)*100, y: ((90-lat)/180)*100 } }
function exitCoordsFor(p: { city?:string; countryCode?:string; countryName?:string; subtitle?:string }){
  const byCity = p.city ? CITY_COORDS[p.city] : undefined
  if(byCity) return { ...byCity, label: p.city as string }
  const byCountry = COUNTRIES.find(c=>c.code===p.countryCode) || COUNTRIES.find(c=>c.name===p.countryName)
  if(byCountry) return { lat:byCountry.lat, lon:byCountry.lon, label:byCountry.name }
  const bySubtitle = p.subtitle ? CITY_COORDS[p.subtitle] : undefined
  if(bySubtitle) return { ...bySubtitle, label: p.subtitle as string }
  return { lat:CITY_COORDS.Toronto.lat, lon:CITY_COORDS.Toronto.lon, label:'Canada' }
}
function profileCountry(p: EditableProfile){
  return {
    name: p.countryName || p.subtitle || 'Canada',
    flag: p.flag || COUNTRIES.find(c=>c.code===p.countryCode)?.flag || '🌐',
    city: p.city && p.city !== 'Fastest' ? p.city : (p.countryName || 'Canada'),
  }
}
function profileForCountry(c: typeof COUNTRIES[number]): EditableProfile {
  return {
    id:`country-${c.code}`, name:c.name, subtitle:c.cities[0], icon:'🌍', color:'#6d4aff', flag:c.flag,
    typeLabel:'Standard', countryCode:c.code, countryName:c.name, city:'Fastest',
    netShield:'On', protocol:'Stealth', natType:'Type 3', lan:'Off', connectAndGo:'Off', customDNS:'Off',
  }
}

/* ------------------------------------------------------------------ */
/*  Auth token                                                         */
/* ------------------------------------------------------------------ */

async function buildAuthTokenAsync(psk: string, path = '/ops'): Promise<string> {
  const ts = Date.now().toString()
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(12))).map(b=>b.toString(16).padStart(2,'0')).join('')
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(psk), { name:'HMAC', hash:'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${ts}.${nonce}.${path}`))
  const hex = [...new Uint8Array(sig)].map(b=>b.toString(16).padStart(2,'0')).join('')
  return `${ts}.${nonce}.${hex}`
}

/* ------------------------------------------------------------------ */
/*  System notifications (OS only — no in-app banner)                  */
/* ------------------------------------------------------------------ */

let notificationsOn = true
function setNotificationsFlag(v:boolean){ notificationsOn = v }
function notificationPermission(): 'granted'|'denied'|'default'|'unsupported' {
  if(typeof Notification === 'undefined') return 'unsupported'
  return Notification.permission as 'granted'|'denied'|'default'
}
function fireSystemNotification(title:string, body:string, icon?:string){
  if(!notificationsOn) return
  try {
    if(notificationPermission() !== 'granted') return
    const n = new Notification(title, { body, icon: icon || '/favicon.png', tag:'openpath-vpn', silent:false, requireInteraction:false } as any)
    ;(window as any).__openpathNotifs = (window as any).__openpathNotifs || []
    ;(window as any).__openpathNotifs.push(n)
    setTimeout(()=>{ try{ n.close() }catch{} }, 6000)
    n.onclick = ()=>{ try{ window.focus() }catch{}; try{ n.close() }catch{} }
  } catch {}
}

/* ------------------------------------------------------------------ */
/*  Small shared UI                                                    */
/* ------------------------------------------------------------------ */

const chevron = (dir:'down'|'right' = 'down') => dir === 'down' ? '⌄' : '›'

function Toggle({ on }:{ on:boolean }){
  return (
    <span style={{ width:38, height:22, borderRadius:999, background:on?'#6d4aff':'#2a2a38', display:'inline-flex', alignItems:'center', padding:2, transition:'background .15s', flexShrink:0 }}>
      <span style={{ marginLeft: on ? 16 : 0, width:18, height:18, borderRadius:999, background:'#fff', transition:'margin .15s' }} />
    </span>
  )
}

function Picker({ label, value, options, onChange, open, onToggle, icon }:
  { label?:string; value:string; options:MenuOption[]; onChange:(v:string)=>void; open:boolean; onToggle:()=>void; icon?:string }){
  return (
    <div>
      {label && <div style={{ color:'#9ca3af', fontSize:11, marginBottom:6, fontWeight:600 }}>{label}</div>}
      <button
        onClick={onToggle}
        aria-expanded={open}
        aria-label={label ? `${label}: ${value}` : value}
        style={{ width:'100%', background:'#23222f', border:`1px solid ${open?'#7c4dff':'#2a2a38'}`, borderRadius:10, padding:'12px 14px', display:'flex', justifyContent:'space-between', alignItems:'center', cursor:'pointer', color:'#fff' }}
      >
        <span style={{ fontSize:13, display:'flex', gap:8, alignItems:'center' }}>{icon && <span>{icon}</span>}{value}</span>
        <span style={{ color:'#9ca3af', display:'inline-block', transform: open?'rotate(180deg)':'none', transition:'transform .15s' }}>{chevron('down')}</span>
      </button>
      {open && (
        <div style={{ marginTop:6, background:'#1a1a24', border:'1px solid #2a2a38', borderRadius:10, overflow:'hidden', maxHeight:240, overflowY:'auto' }}>
          {options.map(o=>(
            <button key={o.value} onClick={()=>onChange(o.value)}
              style={{ width:'100%', textAlign:'left', background: o.value===value ? '#2a2340' : 'transparent', border:0, borderBottom:'1px solid #23222f', color:'#e5e7eb', padding:'11px 14px', fontSize:13, cursor:'pointer', display:'flex', alignItems:'center', gap:8 }}>
              {o.icon && <span>{o.icon}</span>}
              <span>{o.label}</span>
              {o.value===value && <span style={{ marginLeft:'auto', color:'#a78bfa' }}>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Sheet({ open, onClose, title, children }:
  { open:boolean; onClose:()=>void; title:string; children:React.ReactNode }){
  if(!open) return null
  return (
    <div style={{ position:'fixed', inset:0, zIndex:60, display:'flex', flexDirection:'column', justifyContent:'flex-end' }} onClick={onClose}>
      <div style={{ position:'absolute', inset:0, background:'rgba(0,0,0,0.65)' }} />
      <div onClick={e=>e.stopPropagation()} role="dialog" aria-label={title} style={{ position:'relative', background:'#0f0f14', borderTopLeftRadius:16, borderTopRightRadius:16, borderTop:'1px solid #2a2a38', maxHeight:'82vh', overflow:'auto', animation:'slideUp 0.2s ease' }}>
        <div style={{ display:'flex', justifyContent:'center', padding:'10px 0 6px' }}><div style={{ width:36, height:4, borderRadius:999, background:'#3a3a4a' }} /></div>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'2px 16px 12px', borderBottom:'1px solid #1a1a24' }}>
          <div style={{ color:'#fff', fontWeight:700, fontSize:14 }}>{title}</div>
          <button onClick={onClose} aria-label="Close" style={{ background:'transparent', border:'1px solid #2a2a38', color:'#9ca3af', borderRadius:999, width:26, height:26, cursor:'pointer' }}>✕</button>
        </div>
        <div style={{ padding:'14px 16px 22px' }}>{children}</div>
      </div>
    </div>
  )
}

function Section({ title, children }:{ title:string; children:React.ReactNode }){
  return (
    <div style={{ marginTop:18 }}>
      <div style={{ color:'#a78bfa', fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:0.5, marginBottom:8 }}>{title}</div>
      <div style={{ background:'#12121a', border:'1px solid #1f1f2a', borderRadius:12, overflow:'hidden' }}>{children}</div>
    </div>
  )
}

function SettingRow({ icon, title, sub, right, onClick, last }:
  { icon:string; title:string; sub?:string; right?:React.ReactNode; onClick?:()=>void; last?:boolean }){
  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); onClick() } } : undefined}
      style={{ display:'flex', alignItems:'center', gap:12, padding:'13px 14px', borderBottom: last ? 'none' : '1px solid #1f1f2a', cursor: onClick ? 'pointer' : 'default' }}
    >
      <span style={{ width:22, textAlign:'center', fontSize:13 }}>{icon}</span>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ color:'#e5e7eb', fontSize:13, fontWeight:600 }}>{title}</div>
        {sub && <div style={{ color:'#8b8da3', fontSize:11, marginTop:2, lineHeight:1.45 }}>{sub}</div>}
      </div>
      <div style={{ color:'#9ca3af', fontSize:11, display:'flex', alignItems:'center', gap:6, flexShrink:0 }}>{right ?? (onClick ? '›' : null)}</div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  App                                                                */
/* ------------------------------------------------------------------ */

export default function App(){
  const [serverUrlRaw, setServerUrlRaw] = useState(()=>{
    const saved = readJSON<string|null>('openpath:serverUrl', null)
    if(saved) return saved
    if (typeof location !== 'undefined' && location.protocol === 'https:') return `wss://${location.host}/ops`
    if (typeof location !== 'undefined') return `ws://${location.hostname}:4433/ops`
    return 'ws://localhost:4433/ops'
  })
  const [psk] = useState('demo-student-key-do-not-use-prod')
  const [user] = useState('demo')
  const [vpnMode, setVpnMode] = useState<Mode>(()=> readJSON<Mode>('openpath:mode', 'stealth'))
  const [tab, setTabState] = useState<Tab>('home')
  const tabRef = useRef<Tab>('home')
  const [tabHistory, setTabHistory] = useState<Tab[]>([])

  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [selectedProfile, setSelectedProfile] = useState<EditableProfile>(DEFAULT_EDITABLE[3])
  const [hosts, setHosts] = useState<{main:any; hosts:HostEntry[]; online:number; total:number}|null>(null)
  const [clientIp, setClientIp] = useState<string>('')
  const [clientIpLoading, setClientIpLoading] = useState(true)
  const [myLocation, setMyLocation] = useState<GeoPoint>(FALLBACK_LOCATION)
  const [logs, setLogs] = useState<string[]>(()=>[`[${new Date().toLocaleTimeString()}] OpenPath — GhostPath ready.`])
  const [rtt, setRtt] = useState(0)
  const [rx, setRx] = useState(0)
  const [tx, setTx] = useState(0)
  const [startedAt, setStartedAt] = useState<number|null>(null)
  const [now, setNow] = useState(Date.now())
  const wsRef = useRef<WebSocket|null>(null)
  const connectTimer = useRef<any>(null)
  const rxRef = useRef(0)
  const txRef = useRef(0)

  // Notifications (OS only)
  const [notifPerm, setNotifPerm] = useState<string>(notificationPermission())
  const [notifEnabled, setNotifEnabled] = useState<boolean>(()=> readJSON<boolean>('openpath:notifications', true))

  // Editable profiles + sheet + wizard
  const [editableProfiles, setEditableProfiles] = useState<EditableProfile[]>(()=>loadEditable())
  const [sheetProfile, setSheetProfile] = useState<EditableProfile|null>(null)
  const [editing, setEditing] = useState<EditableProfile|null>(null)
  const [editStep, setEditStep] = useState<1|2|3>(1)
  const [wizardError, setWizardError] = useState<string|null>(null)
  const [openMenu, setOpenMenu] = useState<string|null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Releases
  const [releases, setReleases] = useState<any[]|null>(null)
  const [releasesLoading, setReleasesLoading] = useState(false)
  const [releasePlatform, setReleasePlatform] = useState<string>('all')

  // Settings state (kept at App level so it survives re-renders)
  const [showLogs, setShowLogs] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)

  // Home state
  const [shieldOpen, setShieldOpen] = useState(false)
  const [shieldMode, setShieldMode] = useState<ShieldMode>(()=> readJSON<ShieldMode>('openpath:netshield', 'Block malware, ads & trackers'))
  const [recents, setRecents] = useState<RecentEntry[]>(()=> readJSON<RecentEntry[]>('openpath:recents', []))
  const [feedback, setFeedback] = useState<'up'|'down'|null>(()=> readJSON<'up'|'down'|null>('openpath:feedback', null))
  const [infoOpen, setInfoOpen] = useState(false)

  // Toast
  const [toast, setToast] = useState<string|null>(null)
  const toastTimer = useRef<any>(null)
  const notify = (msg:string)=>{
    setToast(msg)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(()=>setToast(null), 2800)
  }

  const log = (m:string)=> setLogs(l=> [...l.slice(-59), `[${new Date().toLocaleTimeString()}] ${m}`])

  const setTab = (next:Tab)=>{
    if(next === tabRef.current) return
    const previous = tabRef.current
    setTabHistory(h=> [...h.slice(-9), previous])
    tabRef.current = next
    setTabState(next)
    setOpenMenu(null)
  }
  const goBack = ()=>{
    if(!tabHistory.length){ notify('Nothing to go back to'); return }
    const prev = tabHistory[tabHistory.length-1]
    setTabHistory(tabHistory.slice(0,-1))
    tabRef.current = prev
    setTabState(prev)
    setOpenMenu(null)
  }

  /* ---------------- effects ---------------- */

  useEffect(()=>{ saveEditable(editableProfiles) },[editableProfiles])
  useEffect(()=>{ writeJSON('openpath:mode', vpnMode) },[vpnMode])
  useEffect(()=>{ writeJSON('openpath:netshield', shieldMode) },[shieldMode])
  useEffect(()=>{ setNotificationsFlag(notifEnabled); writeJSON('openpath:notifications', notifEnabled) },[notifEnabled])
  useEffect(()=>{ if(connected) setNow(Date.now()) },[connected])

  useEffect(()=>{
    if(!connected) return
    const t = setInterval(()=> setNow(Date.now()), 1000)
    return ()=> clearInterval(t)
  },[connected])

  useEffect(()=>{
    const sync = ()=> setNotifPerm(notificationPermission())
    window.addEventListener('focus', sync)
    document.addEventListener('visibilitychange', sync)
    return ()=>{ window.removeEventListener('focus', sync); document.removeEventListener('visibilitychange', sync) }
  },[])

  // client IP (once)
  useEffect(()=>{
    let cancelled=false
    async function fetchIp(){
      try{
        const r = await fetch('/api/ip')
        if(r.ok){ const d=await r.json(); if(!cancelled) setClientIp(d.ip); if(!cancelled) setClientIpLoading(false); return }
      }catch{}
      try{
        const r2 = await fetch('https://api.ipify.org?format=json')
        if(r2.ok){ const d=await r2.json(); if(!cancelled) setClientIp(d.ip) }
      }catch{
        if(!cancelled) setClientIp('203.0.113.42')
      } finally { if(!cancelled) setClientIpLoading(false) }
    }
    fetchIp()
    return ()=>{ cancelled=true }
  },[])

  // Physical location for the map (IP geo → GPS only if already granted → fallback)
  useEffect(()=>{
    let cancelled=false
    ;(async()=>{
      try{
        const r = await fetch('https://ipapi.co/json/')
        if(r.ok){
          const d:any = await r.json()
          if(!cancelled && typeof d.latitude==='number' && typeof d.longitude==='number'){
            setMyLocation({ lat:d.latitude, lon:d.longitude, city:d.city||'Your city', country:d.country_name||'Your country', source:'ip' })
            return
          }
        }
      }catch{}
      try{
        if(typeof navigator!=='undefined' && navigator.geolocation && navigator.permissions){
          const perm = await navigator.permissions.query({ name:'geolocation' as any })
          if(perm.state==='granted'){
            navigator.geolocation.getCurrentPosition(
              pos=>{ if(!cancelled) setMyLocation({ lat:pos.coords.latitude, lon:pos.coords.longitude, city:'Your location', country:'Device GPS', source:'gps' }) },
              ()=>{ if(!cancelled) setMyLocation(FALLBACK_LOCATION) },
              { timeout:4000, maximumAge:600000 }
            )
            return
          }
        }
      }catch{}
      if(!cancelled) setMyLocation(FALLBACK_LOCATION)
    })()
    return ()=>{ cancelled=true }
  },[])

  /* ---------------- data ---------------- */

  const fetchHosts = async (announce = false)=>{
    try{
      const res = await fetch('/api/hosts')
      if(res.ok){
        const d = await res.json()
        setHosts(d)
        log(`Hosts: ${d.online}/${d.total} online`)
        if(announce) notify(`${d.online} of ${d.total} servers online`)
        return
      }
      if(announce) notify('Server list request failed')
    }catch(e:any){
      log(`Hosts fetch failed: ${e.message}`)
      if(announce) notify('Could not reach the server list')
    }
  }
  useEffect(()=>{ fetchHosts() },[])

  const fetchReleases = async (force = false)=>{
    if(releases && !force) return
    setReleasesLoading(true)
    try{
      const r = await fetch('https://api.github.com/repos/mob5824m-wq/OpenPath-VPN/releases?per_page=20')
      setReleases(r.ok ? await r.json() : [])
      if(force) notify(r.ok ? 'Releases refreshed' : 'GitHub did not return releases')
    }catch{
      setReleases([])
      if(force) notify('Could not reach GitHub')
    } finally { setReleasesLoading(false) }
  }

  /* ---------------- connection ---------------- */

  const addRecent = (p: EditableProfile, mode: Mode)=>{
    const c = profileCountry(p)
    const entry: RecentEntry = { profileId:p.id, name:p.name, flag:c.flag, city:c.city, country:c.name, mode, at:Date.now() }
    setRecents(prev=>{
      const next = [entry, ...prev.filter(r=> !(r.profileId===entry.profileId && r.mode===entry.mode))].slice(0,6)
      writeJSON('openpath:recents', next)
      return next
    })
  }

  const closeSocket = ()=>{
    clearTimeout(connectTimer.current)
    const ws = wsRef.current
    wsRef.current = null
    if(ws){
      ws.onclose = null
      try{ ws.close() }catch{}
    }
    setConnected(false)
    setConnecting(false)
    setStartedAt(null)
  }

  const connect = async (override?:string, profile?:EditableProfile, modeArg?:Mode)=>{
    const mode: Mode = modeArg || vpnMode
    const prof: EditableProfile = profile || selectedProfile

    // Already up? Switching exit or profile: close the old tunnel and continue.
    if(wsRef.current){
      closeSocket()
      log('Closing previous tunnel before reconnecting')
    }
    if(profile) setSelectedProfile(profile)

    let u: URL
    try{
      u = new URL(override || serverUrlRaw)
    }catch{
      notify('Server address is not a valid URL')
      log(`Invalid server URL: ${override || serverUrlRaw}`)
      return
    }
    if(u.protocol !== 'ws:' && u.protocol !== 'wss:'){
      notify('Server address must start with ws:// or wss://')
      return
    }

    if(notificationPermission() === 'default'){
      try{ const p = await Notification.requestPermission(); setNotifPerm(p) }catch{}
    }

    const pathForAuth = mode === 'fast' ? '/fast' : '/ops'
    let token:string
    try{ token = await buildAuthTokenAsync(psk, pathForAuth) }
    catch(e:any){ log(`HMAC fail: ${e.message}`); notify('Could not sign the connection request'); return }

    if(mode === 'fast' && u.pathname === '/ops') u.pathname = '/fast'
    if(mode === 'stealth' && u.pathname === '/fast') u.pathname = '/ops'
    u.searchParams.set('auth', token)
    u.searchParams.set('user', user)
    if(mode === 'fast') u.searchParams.set('mode','fast')

    const wsUrl = u.toString()
    const country = profileCountry(prof)
    setConnecting(true)
    log(`Connecting → ${u.host}${u.pathname} ${mode === 'fast' ? '(⚡ Turbo)' : '(Stealth)'}`)

    let opened = false
    const ws = new WebSocket(wsUrl)
    ;(ws as any).binaryType = 'arraybuffer'
    wsRef.current = ws

    const timeout = setTimeout(()=>{
      if(!opened){
        log('Connection timed out after 8s')
        notify('Connection timed out — check the server address')
        closeSocket()
      }
    }, 8000)
    connectTimer.current = timeout

    ws.onopen = ()=>{
      opened = true
      clearTimeout(timeout)
      rxRef.current = 0
      txRef.current = 0
      setRx(0)
      setTx(0)
      setStartedAt(Date.now())
      setConnecting(false)
      setConnected(true)
      setRtt(0)
      log(`✓ Tunnel UP to ${u.host} as ${prof.name}`)
      ws.send(JSON.stringify({ op:'ping', t:Date.now() }))
      addRecent(prof, mode)
      fireSystemNotification(
        `${country.flag} Connected to ${country.name}`,
        `OpenPath • ${prof.name} • ${mode === 'fast' ? 'Turbo' : 'Stealth'} • ${u.host} • Encrypted`
      )
    }
    ws.onmessage = (ev)=>{
      const len = typeof ev.data === 'string' ? ev.data.length : (ev.data as ArrayBuffer).byteLength
      rxRef.current += len
      try{
        const txt = typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data as ArrayBuffer)
        const msg = JSON.parse(txt)
        if(msg.t === 'hello') log(`Server hello ${String(msg.id).slice(0,6)}…`)
        if(msg.op === 'pong') setRtt(Date.now() - (msg.t || Date.now()))
      }catch{}
      setRx(rxRef.current)
      setTx(txRef.current)
    }
    ws.onerror = ()=>{
      if(!opened) log('Transport error — check the server address and key')
    }
    ws.onclose = (e)=>{
      clearTimeout(timeout)
      const wasOpened = opened
      setConnecting(false)
      if(wsRef.current === ws) wsRef.current = null
      setConnected(false)
      setStartedAt(null)
      if(!wasOpened){
        log(`Connection failed (${e.code})`)
        return
      }
      log(`Tunnel closed (${e.code})`)
      fireSystemNotification('OpenPath • Disconnected', `Tunnel closed • IP ${clientIp || 'visible again'}`)
    }
  }

  const disconnect = ()=>{
    if(!wsRef.current){
      notify('Not connected')
      return
    }
    log('Disconnect requested')
    closeSocket()
    fireSystemNotification('OpenPath • Disconnected', 'Tunnel closed • your IP is visible again')
    notify('Disconnected')
  }

  const chooseMode = (mode:Mode)=>{
    if(mode === vpnMode){
      return
    }
    setVpnMode(mode)
    log(`Protocol → ${mode === 'fast' ? 'Turbo' : 'Stealth'}`)
    notify(`${mode === 'fast' ? 'Turbo' : 'Stealth'} protocol selected`)
    if(connected || connecting){
      connect(undefined, undefined, mode)
    }
  }

  /* ---------------- profiles ---------------- */

  const openSheet = (p: EditableProfile)=>{
    setConfirmDelete(false)
    setSheetProfile(p)
  }
  const closeSheet = ()=>{
    setSheetProfile(null)
    setConfirmDelete(false)
  }
  const editAt = (p: EditableProfile, step:1|2|3)=>{
    setEditing({ ...p })
    setEditStep(step)
    setWizardError(null)
    setOpenMenu(null)
    setSheetProfile(null)
    setConfirmDelete(false)
  }
  const wizardBack = ()=>{
    if(editStep > 1){
      setWizardError(null)
      setOpenMenu(null)
      setEditStep(s=> (s-1) as any)
      return
    }
    setEditing(null)
    setWizardError(null)
    setOpenMenu(null)
  }
  const closeWizard = ()=>{
    setEditing(null)
    setWizardError(null)
    setOpenMenu(null)
  }
  const startCreate = ()=>{
    const draft: EditableProfile = {
      id:`custom-${Date.now()}`, name:'', subtitle:'Canada', icon:'⭐', color:'#7c4dff', flag:'🇨🇦',
      typeLabel:'Standard', countryCode:'CA', countryName:'Canada', city:'Fastest',
      netShield:'On', protocol:'Stealth', natType:'Type 3', lan:'Off', connectAndGo:'Off', customDNS:'Off',
    }
    setEditing(draft)
    setEditStep(1)
    setWizardError(null)
    setOpenMenu(null)
  }
  const saveEditing = ()=>{
    if(!editing) return
    const name = editing.name.trim()
    if(!name){ setWizardError('Give your profile a name'); setEditStep(1); return }
    if(!editing.countryCode){ setWizardError('Choose a country'); setEditStep(2); return }
    const dns = (editing.customDNSVal || '').trim()
    if(editing.customDNS === 'On' && dns && !/^\d{1,3}(\.\d{1,3}){3}$/.test(dns)){
      setWizardError('Custom DNS must look like 1.1.1.1')
      return
    }
    const country = COUNTRIES.find(c=>c.code===editing.countryCode)
    const subtitle = editing.city !== 'Fastest'
      ? `${country?.name || editing.countryName} · ${editing.city}`
      : (country?.name || editing.countryName)
    const updated: EditableProfile = {
      ...editing,
      name,
      flag: country?.flag || editing.flag || '🌐',
      countryName: country?.name || editing.countryName,
      subtitle,
      customDNSVal: editing.customDNS === 'On' ? dns : undefined,
    }
    setEditableProfiles(prev=> prev.some(x=>x.id===updated.id) ? prev.map(x=> x.id===updated.id ? updated : x) : [...prev, updated])
    if(selectedProfile.id === updated.id) setSelectedProfile(updated)
    setEditing(null)
    setOpenMenu(null)
    setWizardError(null)
    log(`Saved profile “${updated.name}”`)
    notify(`Profile “${updated.name}” saved`)
    fireSystemNotification(`Profile saved: ${updated.name}`, `${updated.countryName} • ${updated.city} • ${updated.protocol}`)
  }
  const duplicateProfile = (p: EditableProfile)=>{
    const dup: EditableProfile = { ...p, id:`custom-${Date.now()}`, name:`${p.name} copy` }
    setEditableProfiles(prev=> [...prev, dup])
    log(`Duplicated “${p.name}”`)
    notify(`Duplicated “${p.name}”`)
    closeSheet()
  }
  const deleteProfile = (p: EditableProfile)=>{
    if(!confirmDelete){ setConfirmDelete(true); return }
    setEditableProfiles(prev=> prev.filter(x=>x.id!==p.id))
    log(`Deleted profile “${p.name}”`)
    notify(`Deleted “${p.name}”`)
    if(selectedProfile.id === p.id) setSelectedProfile(DEFAULT_EDITABLE[0])
    closeSheet()
  }

  /* ---------------- misc actions ---------------- */

  const copyText = async (text:string, label:string)=>{
    try{ await navigator.clipboard.writeText(text); notify(label) }
    catch{ notify('Clipboard is not available here') }
  }
  const openExternal = (url:string)=>{
    const w = window.open(url, '_blank', 'noopener,noreferrer')
    if(!w) notify(`Popup blocked — open ${url}`)
  }
  const enableNotifications = async ()=>{
    if(typeof Notification === 'undefined'){ notify('This device has no system notifications'); return }
    if(Notification.permission === 'denied'){ notify('Blocked — allow notifications for this site'); return }
    const p = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
    setNotifPerm(p)
    if(p === 'granted'){
      setNotifEnabled(true)
      setNotificationsFlag(true)
      setTimeout(()=> fireSystemNotification('OpenPath VPN', 'Notifications are on. Connect and disconnect alerts appear here.'), 150)
      notify('System notifications enabled')
      log('System notifications enabled')
    } else {
      notify('Permission not granted')
    }
  }
  const toggleNotifications = ()=>{
    if(notifEnabled){ setNotifEnabled(false); notify('System notifications off'); log('System notifications disabled'); return }
    enableNotifications()
  }
  const giveFeedback = (value:'up'|'down')=>{
    const next = feedback === value ? null : value
    setFeedback(next)
    writeJSON('openpath:feedback', next)
    notify(next ? 'Thanks — feedback saved' : 'Feedback cleared')
  }
  const resetLocal = ()=>{
    if(!confirmReset){ setConfirmReset(true); setTimeout(()=>setConfirmReset(false), 4000); return }
    try{
      ['openpath:editable-profiles','openpath:mode','openpath:netshield','openpath:recents','openpath:feedback','openpath:notifications','openpath:serverUrl']
        .forEach(k=> localStorage.removeItem(k))
    }catch{}
    setEditableProfiles(DEFAULT_EDITABLE.map(p=>({ ...p })))
    setVpnMode('stealth')
    setShieldMode('Block malware, ads & trackers')
    setRecents([])
    setFeedback(null)
    setNotifEnabled(true)
    const defaultUrl = typeof location !== 'undefined' && location.protocol === 'https:' ? `wss://${location.host}/ops` : `ws://${location.hostname}:4433/ops`
    setServerUrlRaw(defaultUrl)
    // Persist the defaults so a reload lands in the same clean state
    writeJSON('openpath:mode', 'stealth')
    writeJSON('openpath:netshield', 'Block malware, ads & trackers')
    writeJSON('openpath:recents', [])
    writeJSON('openpath:notifications', true)
    writeJSON('openpath:serverUrl', defaultUrl)
    setConfirmReset(false)
    log('Local profiles and settings reset')
    notify('Local data reset')
  }

  // Window controls only exist in the Electron shells; in a browser they are hidden
  const winCtl: { minimize:()=>void; maximize:()=>void; close:()=>void } | null =
    (typeof window !== 'undefined' && ((window as any).openpathWindow || (window as any).openpath?.window || (window as any).openpathLinux?.window)) || null

  const serverUrlValid = (()=>{ try{ const u = new URL(serverUrlRaw); return u.protocol==='ws:' || u.protocol==='wss:' }catch{ return false } })()
  const commitServerUrl = (v:string)=>{
    setServerUrlRaw(v)
    // Only remember addresses we can actually dial — validate the incoming value,
    // not the previous render's state.
    try{
      const u = new URL(v)
      if(u.protocol === 'ws:' || u.protocol === 'wss:') writeJSON('openpath:serverUrl', v)
    }catch{}
  }

  const durationMs = startedAt ? Math.max(0, now - startedAt) : 0
  const effectiveShield: ShieldMode = connected && selectedProfile.netShield === 'Off' ? 'Off' : shieldMode
  const locationText = myLocation.source === 'default' ? myLocation.country : `${myLocation.city}, ${myLocation.country}`
  const locationCity = myLocation.source === 'default' ? '' : myLocation.city
  const serverHost = (()=>{ try{ return new URL(serverUrlRaw).host }catch{ return serverUrlRaw } })()

  /* ---------------- chrome ---------------- */

  const TopChrome = () => (
    <div style={{ height:28, background:'#0a0a0f', display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 12px', borderBottom:'1px solid #1a1a24', flexShrink:0 }}>
      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
        <button
          onClick={goBack}
          aria-label="Back"
          title={tabHistory.length ? 'Back' : 'Nothing to go back to'}
          style={{ background:'transparent', border:0, color: tabHistory.length ? '#fff' : '#4b5563', cursor: tabHistory.length ? 'pointer' : 'default', padding:4, fontSize:14 }}
        >‹</button>
      </div>
      {winCtl ? (
        <div style={{ display:'flex', alignItems:'center', gap:14, color:'#6b7280', fontSize:12 }}>
          <button onClick={()=>winCtl.minimize()} aria-label="Minimize" title="Minimize" style={{ background:'transparent', border:0, color:'#6b7280', cursor:'pointer', fontSize:12 }}>—</button>
          <button onClick={()=>winCtl.maximize()} aria-label="Maximize" title="Maximize" style={{ background:'transparent', border:0, color:'#6b7280', cursor:'pointer', fontSize:12 }}>▭</button>
          <button onClick={()=>winCtl.close()} aria-label="Close window" title="Close" style={{ background:'transparent', border:0, color:'#6b7280', cursor:'pointer', fontSize:13 }}>✕</button>
        </div>
      ) : <span />}
    </div>
  )

  const WorldMap = ({ highlighted }:{ highlighted?: boolean }) => {
    const you = projectPoint(myLocation.lat, myLocation.lon)
    const exit = projectPoint(exitCoordsFor(selectedProfile).lat, exitCoordsFor(selectedProfile).lon)
    return (
      <div style={{ position:'relative', height:220, overflow:'hidden', background:'#08080c' }}>
        <svg viewBox="0 0 1000 500" style={{ width:'100%', height:'100%', opacity: highlighted ? 1 : 0.55 }}>
          <path d="M 40 80 L 90 60 L 140 80 L 180 120 L 220 140 L 260 130 L 240 180 L 200 210 L 160 200 L 120 160 L 60 140 Z" fill="#3a3850" stroke="#4a4860" strokeWidth="1"/>
          <path d="M 60 220 L 90 200 L 130 210 L 150 250 L 110 280 L 60 260 Z" fill="#3a3850" stroke="#4a4860" strokeWidth="1"/>
          <path d="M 220 300 L 260 290 L 290 320 L 280 380 L 240 420 L 210 360 Z" fill="#3a3850" stroke="#4a4860" strokeWidth="1"/>
          <path d="M 460 100 L 520 90 L 560 110 L 540 150 L 500 160 L 460 130 Z" fill="#3a3850" stroke="#4a4860" strokeWidth="1"/>
          <path d="M 480 180 L 540 170 L 570 220 L 550 300 L 510 320 L 470 260 L 460 200 Z" fill="#3a3850" stroke="#4a4860" strokeWidth="1"/>
          <path d="M 580 80 L 750 60 L 850 90 L 880 150 L 820 180 L 760 160 L 650 140 L 580 110 Z" fill="#3a3850" stroke="#4a4860" strokeWidth="1"/>
          <path d="M 600 170 L 750 180 L 820 220 L 780 280 L 660 260 L 600 200 Z" fill="#3a3850" stroke="#4a4860" strokeWidth="1"/>
          <path d="M 770 360 L 850 350 L 870 390 L 820 410 L 760 390 Z" fill="#3a3850" stroke="#4a4860" strokeWidth="1"/>
          {Array.from({length:200}).map((_,i)=>{
            const x = (i*73)%1000; const y = (i*97)%500
            return <circle key={i} cx={x} cy={y} r="0.6" fill="#2a2a40" opacity="0.5"/>
          })}
        </svg>
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
        <div style={{ position:'absolute', left:`${you.x}%`, top:`${you.y}%`, width: highlighted ? 18 : 26, height: highlighted ? 18 : 26, background: highlighted ? 'rgba(148,163,184,0.25)' : 'rgba(59,130,246,0.28)', borderRadius:999, display:'grid', placeItems:'center', transform:'translate(-50%,-50%)', transition:'all 0.2s' }}>
          <div style={{ width: highlighted ? 8 : 12, height: highlighted ? 8 : 12, background: highlighted ? '#94a3b8' : '#3b82f6', borderRadius:999, border:`${highlighted?2:3}px solid #fff`, boxShadow: highlighted ? '0 0 8px rgba(148,163,184,0.8)' : '0 0 14px rgba(59,130,246,1)' }} />
          {!highlighted && <div style={{ position:'absolute', inset:0, borderRadius:999, border:'1px solid rgba(59,130,246,0.7)', animation:'pulse 2s infinite' } as any} />}
        </div>
        <div style={{ position:'absolute', left:`${you.x}%`, top:`calc(${you.y}% + ${highlighted?12:18}px)`, transform:'translateX(-50%)', whiteSpace:'nowrap', fontSize:9, fontWeight:700, color: highlighted ? '#cbd5e1' : '#bfdbfe', background:'rgba(0,0,0,0.65)', border:`1px solid ${highlighted?'#2a2a38':'rgba(59,130,246,0.5)'}`, borderRadius:999, padding:'1px 7px' }}>
          {highlighted ? 'You' : `Your location${locationCity ? ` · ${locationCity}` : ''}`}
        </div>
        <div style={{ position:'absolute', inset:0, background:'linear-gradient(to top, #0a0a0f 0%, transparent 40%, transparent 70%, rgba(10,106,90,0.25) 100%)', pointerEvents:'none' }} />
      </div>
    )
  }

  /* ---------------- Home ---------------- */

  const HomeTab = () => (
    <div style={{ display:'grid', gap:0, background:'#000', minHeight:'100%' }}>
      <div style={{
        background: connected ? 'linear-gradient(180deg, #0e6b52 0%, #0a3a2e 60%, #0a0a0f 100%)' : 'linear-gradient(180deg, #1a1a24 0%, #0a0a0f 100%)',
        padding:'14px 16px 10px', textAlign:'center', borderBottom:'1px solid #1a1a24',
      }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:8, color: connected ? '#5eefc1' : connecting ? '#fbbf24' : '#f87171', fontWeight:800, fontSize:15 }}>
          <span style={{ width:18, height:18, borderRadius:999, background: connected ? '#0ac47e' : connecting ? '#f59e0b' : '#ef4444', display:'grid', placeItems:'center', fontSize:11, color:'#fff' }}>{connected ? '🔒' : connecting ? '…' : '🔓'}</span>
          {connected ? 'Protected' : connecting ? 'Connecting…' : 'Not protected'}
        </div>

        {!connected && !connecting && (
          <div style={{ marginTop:8, color:'#e5e7eb', fontSize:12, lineHeight:1.6 }}>
            <div style={{ color:'#fbbf24', fontWeight:700 }}>⚠️ IP visible</div>
            <div style={{ color:'#9ca3af', fontSize:11 }}>Your IP is <span style={{ color:'#fff', fontFamily:'monospace', fontWeight:700 }}>{clientIpLoading ? '…' : clientIp || '—'}</span></div>
            <div style={{ color:'#9ca3af', fontSize:11, marginTop:2 }}>Your location: <span style={{ color:'#bfdbfe', fontWeight:700 }}>{locationText}</span></div>
            <div style={{ color:'#9ca3af', fontSize:11, marginTop:2 }}>Not connected • Traffic is visible to your network &amp; ISP</div>
            <button onClick={()=>connect()} style={{ marginTop:10, background:'#6d4aff', color:'#fff', border:0, padding:'10px 28px', borderRadius:999, fontWeight:800, cursor:'pointer', fontSize:13 }}>Quick Connect</button>
          </div>
        )}
        {connecting && (
          <div style={{ marginTop:10, color:'#fbbf24', fontSize:12 }}>Opening tunnel to {serverHost}…</div>
        )}
        {connected && (
          <div style={{ color:'#a7f3d0', fontSize:11, marginTop:4 }}>Encrypted • {vpnMode === 'fast' ? 'TurboDirect' : 'GhostPath Stealth'} • RTT {rtt} ms</div>
        )}

        <button
          onClick={()=>setShieldOpen(true)}
          aria-label="NetShield settings"
          style={{ width:'100%', marginTop:14, background:'#1c1b26', border:'1px solid #2a2a38', borderRadius:12, padding:'10px 12px', display:'flex', alignItems:'center', justifyContent:'space-between', cursor:'pointer', color:'inherit', textAlign:'left' }}
        >
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <span style={{ width:24, height:24, borderRadius:6, background:'linear-gradient(135deg, #0ac47e, #06b6d4)', display:'grid', placeItems:'center', fontSize:12 }}>🛡️</span>
            <div>
              <div style={{ color:'#fff', fontWeight:700, fontSize:12 }}>NetShield</div>
              <div style={{ color:'#9ca3af', fontSize:10 }}>{effectiveShield === 'Off' ? 'Off — no blocking' : connected ? effectiveShield : `${effectiveShield} • applies when connected`}</div>
            </div>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:6, color:'#9ca3af', fontSize:12 }}>
            <span style={{ color:'#fff', fontSize:12, fontWeight:700 }}>{effectiveShield === 'Off' ? 'Off' : 'On'}</span>
            <span>›</span>
          </div>
        </button>

        <div style={{ marginTop:8, background:'#13131a', borderRadius:10, padding:'8px 10px', display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:6, border:'1px solid #1f1f2a' }}>
          <div style={{ textAlign:'center' }}><div style={{ color:'#fff', fontWeight:800, fontSize:13 }}>{fmtBytes(rx)}</div><div style={{ color:'#8b8da3', fontSize:9 }}>Downloaded</div></div>
          <div style={{ textAlign:'center', borderLeft:'1px solid #2a2a38', borderRight:'1px solid #2a2a38' }}><div style={{ color:'#fff', fontWeight:800, fontSize:13 }}>{fmtBytes(tx)}</div><div style={{ color:'#8b8da3', fontSize:9 }}>Uploaded</div></div>
          <div style={{ textAlign:'center' }}><div style={{ color:'#fff', fontWeight:800, fontSize:13 }}>{fmtDuration(durationMs)}</div><div style={{ color:'#8b8da3', fontSize:9 }}>Session</div></div>
        </div>
      </div>

      {WorldMap({ highlighted: connected })}

      <div style={{ background:'#0a0a0f', padding:'10px 16px', display:'flex', alignItems:'center', justifyContent:'space-between', borderTop:'1px solid #1a1a24', borderBottom:'1px solid #1a1a24' }}>
        <span style={{ color:'#e5e7eb', fontSize:12 }}>{feedback ? 'Thanks for the feedback' : 'How is your connection?'}</span>
        <div style={{ display:'flex', gap:12, alignItems:'center' }}>
          <button onClick={()=>giveFeedback('down')} aria-label="Bad connection" aria-pressed={feedback==='down'}
            style={{ background: feedback==='down' ? '#2a2340' : 'transparent', border: feedback==='down' ? '1px solid #7c4dff' : '1px solid transparent', borderRadius:8, cursor:'pointer', fontSize:14, color:'#6b7280', padding:'2px 6px' }}>👎</button>
          <span style={{ width:1, height:14, background:'#2a2a38' }} />
          <button onClick={()=>giveFeedback('up')} aria-label="Good connection" aria-pressed={feedback==='up'}
            style={{ background: feedback==='up' ? '#2a2340' : 'transparent', border: feedback==='up' ? '1px solid #7c4dff' : '1px solid transparent', borderRadius:8, cursor:'pointer', fontSize:14, color:'#6b7280', padding:'2px 6px' }}>👍</button>
        </div>
      </div>

      <div style={{ padding:12, background:'#000', paddingBottom:80 }}>
        {connected ? (
          <div style={{ background:'#1c1b26', border:'1px solid #2a2a38', borderRadius:16, padding:14 }}>
            <button
              onClick={()=>openSheet(selectedProfile)}
              aria-label={`Open ${selectedProfile.name} details`}
              style={{ display:'flex', alignItems:'center', gap:10, width:'100%', background:'transparent', border:0, cursor:'pointer', color:'inherit', textAlign:'left', padding:0 }}
            >
              <div style={{ width:36, height:36, borderRadius:8, background:'#2a2a38', display:'grid', placeItems:'center', fontSize:14, position:'relative' }}>
                {selectedProfile.icon}
                <span style={{ position:'absolute', bottom:-2, right:-2, background:'#fff', borderRadius:999, width:14, height:14, display:'grid', placeItems:'center', fontSize:9, border:'1px solid #ddd' }}>{selectedProfile.flag || '🌐'}</span>
              </div>
              <div style={{ flex:1 }}>
                <div style={{ color:'#fff', fontWeight:700, fontSize:14 }}>{selectedProfile.name}</div>
                <div style={{ color:'#9ca3af', fontSize:12 }}>{profileCountry(selectedProfile).name}{selectedProfile.city !== 'Fastest' ? ` • ${selectedProfile.city}` : ''} • {vpnMode === 'fast' ? 'Turbo' : 'Stealth'}</div>
              </div>
              <span style={{ color:'#6b7280', fontSize:16 }}>⌃</span>
            </button>
            <button onClick={disconnect} style={{ width:'100%', marginTop:12, background:'#2a2a38', color:'#e5e7eb', border:'1px solid #3a3a4a', padding:'12px', borderRadius:10, fontWeight:700, cursor:'pointer' }}>Disconnect</button>
            <button onClick={()=>setTab('countries')} style={{ width:'100%', marginTop:8, background:'transparent', color:'#e5e7eb', border:'1px solid #2a2a38', padding:'11px', borderRadius:10, fontWeight:600, cursor:'pointer' }}>Change server</button>
            <div style={{ marginTop:10, display:'flex', justifyContent:'center', gap:8 }}>
              <span style={{ width:8, height:8, borderRadius:999, background:'#0ac47e', boxShadow:'0 0 8px #0ac47e' }} />
              <span style={{ color:'#9ca3af', fontSize:11 }}>Protected • ↓ {fmtBytes(rx)} ↑ {fmtBytes(tx)}</span>
            </div>
          </div>
        ) : (
          <div style={{ background:'#1c1b26', border:'1px solid #2a2a38', borderRadius:16, padding:14, textAlign:'center' }}>
            <div style={{ color:'#f87171', fontWeight:700, fontSize:13, display:'flex', alignItems:'center', justifyContent:'center', gap:6 }}>🔓 Not protected</div>
            <div style={{ color:'#9ca3af', fontSize:12, marginTop:6, lineHeight:1.5 }}>
              Your IP <span style={{ color:'#fff', fontFamily:'monospace' }}>{clientIpLoading ? '…' : clientIp}</span> is visible.<br/>
              Your location <span style={{ color:'#bfdbfe', fontWeight:700 }}>{locationText}</span><br/>
              Connect to hide your location and encrypt traffic.
            </div>
            <div style={{ marginTop:10, display:'flex', gap:8 }}>
              <button onClick={()=>connect()} disabled={connecting} style={{ flex:1, background: connecting ? '#4a3a9a' : '#6d4aff', color:'#fff', border:0, padding:'12px', borderRadius:10, fontWeight:800, cursor: connecting ? 'default' : 'pointer' }}>{connecting ? 'Connecting…' : 'Quick Connect'}</button>
              <button onClick={()=>setTab('countries')} style={{ flex:1, background:'transparent', color:'#e5e7eb', border:'1px solid #3a3a4a', padding:'12px', borderRadius:10, fontWeight:600, cursor:'pointer' }}>Change server</button>
            </div>
            <div style={{ marginTop:10, fontSize:11, color:'#6b7280' }}>Default: <span style={{ color:'#a78bfa' }}>{selectedProfile.name} • {selectedProfile.subtitle}</span></div>
          </div>
        )}

        <div style={{ marginTop:12, background:'#0f0f14', border:'1px solid #1f1f2a', borderRadius:12, padding:10, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div style={{ fontSize:11, color:'#9ca3af' }}>{vpnMode === 'fast' ? '⚡ Turbo' : '🛡️ Stealth'} • {vpnMode === 'fast' ? 'Plain WebSocket' : 'TLS-in-TLS, Fortinet-safe'}</div>
          <div style={{ display:'flex', gap:6, background:'#1a1a24', borderRadius:999, padding:3 }}>
            <button onClick={()=>chooseMode('stealth')} aria-pressed={vpnMode==='stealth'} style={{ padding:'5px 10px', borderRadius:999, border:0, fontSize:11, fontWeight:700, cursor:'pointer', background: vpnMode === 'stealth' ? '#6d4aff' : 'transparent', color: vpnMode === 'stealth' ? '#fff' : '#9ca3af' }}>Stealth</button>
            <button onClick={()=>chooseMode('fast')} aria-pressed={vpnMode==='fast'} style={{ padding:'5px 10px', borderRadius:999, border:0, fontSize:11, fontWeight:700, cursor:'pointer', background: vpnMode === 'fast' ? '#f59e0b' : 'transparent', color: vpnMode === 'fast' ? '#fff' : '#9ca3af' }}>Turbo</button>
          </div>
        </div>

        <div style={{ marginTop:14 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
            <div style={{ color:'#e5e7eb', fontWeight:700, fontSize:12 }}>Recents</div>
            {recents.length > 0 && (
              <button onClick={()=>{ setRecents([]); writeJSON('openpath:recents', []); notify('Recents cleared') }}
                style={{ background:'transparent', border:0, color:'#9ca3af', fontSize:11, cursor:'pointer' }}>Clear</button>
            )}
          </div>
          {recents.length === 0 ? (
            <div style={{ color:'#6b7280', fontSize:11, textAlign:'center', padding:'12px 0', border:'1px dashed #1f1f2a', borderRadius:10 }}>No recent connections — connect to see history</div>
          ) : recents.map(r=>(
            <button key={`${r.profileId}-${r.at}`} onClick={()=>{
              const p = editableProfiles.find(x=>x.id===r.profileId) || {
                ...DEFAULT_EDITABLE[0], id:r.profileId, name:r.name, flag:r.flag, city:r.city, countryName:r.country, subtitle:r.country,
              }
              connect(undefined, p, r.mode)
            }}
              style={{ width:'100%', display:'flex', alignItems:'center', gap:10, background:'#0f0f14', border:'1px solid #1f1f2a', borderRadius:10, padding:'10px 12px', marginBottom:6, cursor:'pointer', color:'inherit', textAlign:'left' }}>
              <span style={{ fontSize:16 }}>{r.flag}</span>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ color:'#fff', fontSize:12, fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.name}</div>
                <div style={{ color:'#8b8da3', fontSize:10 }}>{r.city} • {r.mode === 'fast' ? 'Turbo' : 'Stealth'} • {ago(r.at)}</div>
              </div>
              <span style={{ color:'#a78bfa', fontSize:11, fontWeight:700 }}>Reconnect</span>
            </button>
          ))}
        </div>

        <div style={{ marginTop:14, background:'#0f0f14', border:'1px solid #1f1f2a', borderRadius:10, padding:12 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <div style={{ color:'#e5e7eb', fontWeight:700, fontSize:12 }}>Releases</div>
            <button onClick={()=>{ setTab('releases'); fetchReleases() }} style={{ background:'#1a1a24', border:'1px solid #2a2a38', color:'#a78bfa', padding:'4px 8px', borderRadius:999, fontSize:11, cursor:'pointer' }}>View all →</button>
          </div>
          <div style={{ color:'#9ca3af', fontSize:11, marginTop:6 }}>
            {releases ? `${releases.length} releases • latest ${releases[0]?.tag_name || releases[0]?.name || 'v1.1'}` : 'Native installers for Windows, macOS, Linux, Android & iOS'}
          </div>
          <div style={{ marginTop:8, display:'flex', gap:6, flexWrap:'wrap' }}>
            {['windows','macos','linux','android','ios'].map(id=>(
              <button key={id} onClick={()=>{ setReleasePlatform(id); setTab('releases'); fetchReleases() }}
                style={{ background:'#1a1a24', border:'1px solid #2a2a38', color:'#e5e7eb', padding:'3px 8px', borderRadius:999, fontSize:10, cursor:'pointer' }}>
                {PLATFORM_FILTERS.find(p=>p.id===id)?.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginTop:10, fontSize:10, color:'#4b5563', textAlign:'center' }}>OpenPath • {hosts?.online ?? 0}/{hosts?.total ?? 0} servers • {serverHost} • key hidden</div>
      </div>
    </div>
  )

  /* ---------------- Countries ---------------- */

  const CountriesTab = () => (
    <div style={{ background:'#000', minHeight:'100%', paddingBottom:80 }}>
      <div style={{ padding:'16px 16px 10px', position:'sticky', top:0, background:'#000', zIndex:2 }}>
        <div style={{ color:'#fff', fontWeight:800, fontSize:18 }}>Countries</div>
        <div style={{ color:'#9ca3af', fontSize:11, marginTop:4 }}>Pick the fastest exit. The list loads once from <code style={{ background:'#1a1a24', padding:'2px 6px', borderRadius:6 }}>GET /api/hosts</code>.</div>
        <div style={{ marginTop:10, display:'flex', gap:6 }}>
          <input
            value={serverUrlRaw}
            onChange={e=>commitServerUrl(e.target.value)}
            aria-label="Server address"
            spellCheck={false}
            style={{ flex:1, background:'#1a1a24', border:`1px solid ${serverUrlValid ? '#2a2a38' : '#ef4444'}`, color:'#e5e7eb', padding:'8px 10px', borderRadius:8, fontSize:11, fontFamily:'monospace' }}
          />
          <button onClick={()=>fetchHosts(true)} aria-label="Refresh server list" title="Refresh server list"
            style={{ background:'#1a1a24', border:'1px solid #2a2a38', color:'#e5e7eb', padding:'0 12px', borderRadius:8, cursor:'pointer', fontSize:12 }}>↻</button>
        </div>
        {!serverUrlValid && <div style={{ color:'#f87171', fontSize:10, marginTop:6 }}>Use a ws:// or wss:// address — this one is ignored.</div>}
      </div>
      <div style={{ padding:'0 12px', display:'grid', gap:8 }}>
        {COUNTRIES.map(c=>{
          const isCurrent = connected && selectedProfile.name === c.name
          return (
            <div key={c.code} onClick={()=>{ if(isCurrent) disconnect(); else connect(undefined, profileForCountry(c)) }}
              style={{ background: isCurrent ? '#12211c' : '#12121a', border:`1px solid ${isCurrent?'#0ac47e':'#1f1f2a'}`, borderRadius:12, padding:'12px 14px', display:'flex', alignItems:'center', justifyContent:'space-between', cursor:'pointer' }}>
              <div style={{ display:'flex', gap:10, alignItems:'center' }}>
                <span style={{ fontSize:22 }}>{c.flag}</span>
                <div>
                  <div style={{ color:'#fff', fontWeight:700, fontSize:13 }}>{c.name} <span style={{ color:'#6b7280', fontWeight:400, fontSize:11 }}>• {c.cities.join(', ')}</span></div>
                  <div style={{ color:'#9ca3af', fontSize:11 }}>{c.load}% load • {c.p2p ? 'P2P • ' : ''}{c.tor ? 'Tor • ' : ''}Stealth</div>
                </div>
              </div>
              <span style={{ color: isCurrent ? '#0ac47e' : '#6d4aff', fontSize:11, fontWeight:700, border:`1px solid ${isCurrent ? '#0ac47e' : '#6d4aff'}`, padding:'4px 8px', borderRadius:999 }}>{isCurrent ? 'Disconnect' : 'Connect'}</span>
            </div>
          )
        })}
        {hosts && (
          <div style={{ background:'#0f0f14', border:'1px solid #1f1f2a', borderRadius:12, padding:12 }}>
            <div style={{ color:'#e5e7eb', fontWeight:700, fontSize:12 }}>Server directory</div>
            <div style={{ color:'#fff', fontFamily:'monospace', fontSize:11, marginTop:6 }}>{hosts.main?.wssUrl}</div>
            <div style={{ color:'#9ca3af', fontSize:11, marginTop:4 }}>{hosts.hosts.length} sub-hosts registered • tap ↻ to refresh</div>
          </div>
        )}
      </div>
    </div>
  )

  /* ---------------- Profile sheet ---------------- */

  const ProfileSheet = () => {
    if(!sheetProfile) return null
    const p = sheetProfile
    const isThisConnected = connected && selectedProfile.id === p.id
    const detailRows: { label:string; value:string; step:1|2|3 }[] = [
      { label:'NetShield', value:p.netShield, step:3 },
      { label:'Custom DNS', value:p.customDNS === 'On' ? (p.customDNSVal || 'On') : 'Off', step:3 },
      { label:'Protocol', value:p.protocol, step:3 },
      { label:'NAT', value:p.natType, step:3 },
      { label:'LAN', value:p.lan, step:3 },
      { label:'Country', value:`${p.flag || '🌐'} ${p.countryName}`, step:2 },
    ]
    return (
      <div style={{ position:'fixed', inset:0, zIndex:30, display:'flex', flexDirection:'column', justifyContent:'flex-end' }} onClick={closeSheet}>
        <div style={{ position:'absolute', inset:0, background:'rgba(0,0,0,0.6)' }} />
        <div onClick={e=>e.stopPropagation()} style={{ position:'relative', background:'#0f0f14', borderTopLeftRadius:16, borderTopRightRadius:16, borderTop:'1px solid #2a2a38', maxHeight:'78vh', overflow:'auto', animation:'slideUp 0.2s ease' }}>
          <div style={{ display:'flex', justifyContent:'center', padding:'10px 0 6px' }}><div style={{ width:36, height:4, borderRadius:999, background:'#3a3a4a' }} /></div>
          <div style={{ padding:'8px 16px 12px', display:'flex', alignItems:'center', gap:12, borderBottom:'1px solid #1a1a24' }}>
            <div style={{ width:36, height:36, borderRadius:8, background:'#1e1b2e', border:'1px solid #2a2a38', display:'grid', placeItems:'center', fontSize:16 }}>{p.icon}</div>
            <div style={{ flex:1 }}>
              <div style={{ color:'#fff', fontWeight:700, fontSize:13 }}>{p.name}</div>
              <div style={{ color:'#9ca3af', fontSize:11 }}>{p.countryName}{p.city && p.city !== 'Fastest' ? ` • ${p.city}` : ' • Fastest'}</div>
            </div>
            <button onClick={closeSheet} aria-label="Close" style={{ background:'transparent', border:'1px solid #2a2a38', borderRadius:999, color:'#9ca3af', width:26, height:26, cursor:'pointer' }}>✕</button>
          </div>
          <div style={{ padding:'14px 16px' }}>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, fontSize:12 }}>
              {detailRows.map(r=>(
                <button key={r.label} onClick={()=>editAt(p, r.step)} aria-label={`Edit ${r.label}`}
                  style={{ textAlign:'left', background:'transparent', border:0, borderTop:'1px solid #1a1a24', paddingTop:10, cursor:'pointer', color:'inherit' }}>
                  <div style={{ color:'#9ca3af', fontSize:11 }}>{r.label} <span style={{ color:'#4b5563' }}>›</span></div>
                  <div style={{ color:'#e5e7eb', fontWeight:600, marginTop:2 }}>{r.value}</div>
                </button>
              ))}
            </div>
            <div style={{ marginTop:16, display:'grid', gap:0, background:'#1a1a24', borderRadius:12, overflow:'hidden', border:'1px solid #2a2a38' }}>
              <button onClick={()=>editAt(p,1)} style={{ textAlign:'left', background:'transparent', border:0, padding:'14px 16px', color:'#e5e7eb', fontSize:13, cursor:'pointer', display:'flex', alignItems:'center', gap:12, borderBottom:'1px solid #2a2a38' }}><span>✎</span> Edit</button>
              <button onClick={()=>duplicateProfile(p)} style={{ textAlign:'left', background:'transparent', border:0, padding:'14px 16px', color:'#e5e7eb', fontSize:13, cursor:'pointer', display:'flex', alignItems:'center', gap:12, borderBottom:'1px solid #2a2a38' }}><span>⧉</span> Duplicate</button>
              <button onClick={()=>deleteProfile(p)} style={{ textAlign:'left', background:'transparent', border:0, padding:'14px 16px', color: confirmDelete ? '#fecaca' : '#f87171', fontSize:13, cursor:'pointer', display:'flex', alignItems:'center', gap:12 }}>
                <span>🗑</span> {confirmDelete ? 'Tap again to delete' : 'Delete'}
              </button>
            </div>
            <button onClick={()=>{ if(isThisConnected) disconnect(); else connect(undefined, p) }}
              style={{ marginTop:12, width:'100%', background: isThisConnected ? '#2a2a38' : '#6d4aff', color:'#fff', border: isThisConnected ? '1px solid #3a3a4a' : 0, padding:'13px', borderRadius:12, fontWeight:800, cursor:'pointer' }}>
              {isThisConnected ? 'Disconnect' : connecting ? 'Connecting…' : 'Connect'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  /* ---------------- Edit wizard ---------------- */

  const EditWizard = () => {
    if(!editing) return null
    const stepPct = editStep === 1 ? 33 : editStep === 2 ? 66 : 100
    const e = editing
    const country = COUNTRIES.find(c=>c.code===e.countryCode) || COUNTRIES[0]
    const cityOptions: MenuOption[] = ['Fastest', ...country.cities].map(c=>({ value:c, label:c, icon: c === 'Fastest' ? '⚡' : '📍' }))
    const set = (patch:Partial<EditableProfile>)=> setEditing({ ...e, ...patch })

    const settingRow = (key:string, label:string, value:string, options:MenuOption[], onChange:(v:string)=>void, hint?:string)=>(
      <div>
        <Picker
          label={label}
          value={value}
          options={options}
          onChange={v=>{ onChange(v); setOpenMenu(null) }}
          open={openMenu === key}
          onToggle={()=>setOpenMenu(openMenu === key ? null : key)}
          icon={key === 'netShield' && value === 'On' ? '🛡️' : undefined}
        />
        {hint && <div style={{ color:'#6b7280', fontSize:10, marginTop:4 }}>{hint}</div>}
      </div>
    )

    return (
      <div style={{ position:'fixed', inset:0, zIndex:40, background:'#000', display:'flex', flexDirection:'column' }}>
        <div style={{ height:28, background:'#0a0a0f', display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 12px', borderBottom:'1px solid #1a1a24', flexShrink:0 }}>
          <button onClick={wizardBack} aria-label={editStep > 1 ? 'Previous step' : 'Close editor'} style={{ background:'transparent', border:0, color:'#fff', fontSize:12, cursor:'pointer' }}>‹</button>
          {winCtl ? (
            <div style={{ display:'flex', gap:14, color:'#6b7280', fontSize:12 }}>
              <button onClick={()=>winCtl.minimize()} aria-label="Minimize" style={{ background:'transparent', border:0, color:'#6b7280', cursor:'pointer' }}>—</button>
              <button onClick={()=>winCtl.maximize()} aria-label="Maximize" style={{ background:'transparent', border:0, color:'#6b7280', cursor:'pointer' }}>▭</button>
              <button onClick={closeWizard} aria-label="Close editor" style={{ background:'transparent', border:0, color:'#6b7280', cursor:'pointer' }}>✕</button>
            </div>
          ) : (
            <button onClick={closeWizard} aria-label="Close editor" style={{ background:'transparent', border:0, color:'#6b7280', cursor:'pointer' }}>✕</button>
          )}
        </div>
        <div style={{ background:'#000', borderBottom:'1px solid #1a1a24' }}>
          <div style={{ display:'flex', alignItems:'center', gap:10, padding:'12px 16px' }}>
            <button onClick={closeWizard} aria-label="Close editor" style={{ background:'transparent', border:0, color:'#fff', cursor:'pointer', fontSize:16 }}>✕</button>
            <span style={{ color:'#fff', fontWeight:700, fontSize:14 }}>Edit {e.name.trim() || 'profile'}</span>
          </div>
          <div style={{ height:2, background:'#1a1a24', position:'relative' }}>
            <div style={{ position:'absolute', left:0, top:0, bottom:0, width:`${stepPct}%`, background:'#7c4dff', transition:'width 0.2s' }} />
          </div>
          <div style={{ display:'flex', justifyContent:'space-between', padding:'8px 16px' }}>
            <span style={{ color:'#7c4dff', fontSize:11, fontWeight:600 }}>Step {editStep} of 3</span>
            {wizardError && <span style={{ color:'#f87171', fontSize:11 }}>{wizardError}</span>}
          </div>
        </div>

        <div style={{ flex:1, overflow:'auto', padding:'24px 20px 20px', background:'#000' }} onClick={()=> setOpenMenu(null)}>
          {editStep === 1 && (
            <div style={{ maxWidth:520, margin:'0 auto' }} onClick={e2=>e2.stopPropagation()}>
              <label htmlFor="profile-name" style={{ color:'#9ca3af', fontSize:11, fontWeight:600 }}>Name</label>
              <input id="profile-name" value={e.name} onChange={ev=>set({ name:ev.target.value })} placeholder="School"
                style={{ width:'100%', background:'transparent', border:0, borderBottom:'2px solid #7c4dff', color:'#fff', fontSize:15, padding:'8px 4px', outline:'none', marginTop:4 }} />
              <div style={{ marginTop:22, display:'flex', gap:14, justifyContent:'center', alignItems:'center' }}>
                {PROFILE_COLORS.map(c=>(
                  <button key={c} onClick={()=>set({ color:c })} aria-label={`Colour ${c}`} aria-pressed={e.color===c}
                    style={{ width:22, height:22, borderRadius:999, background:c, border: e.color===c ? '2px solid #fff' : '2px solid transparent', boxShadow: e.color===c ? '0 0 0 2px #7c4dff' : 'none', cursor:'pointer' }} />
                ))}
              </div>
              <div style={{ marginTop:20, display:'grid', gridTemplateColumns:'repeat(6, 1fr)', gap:14 }}>
                {ICON_GRID.map(ic=>{
                  const selected = e.icon === ic.e
                  return (
                    <button key={ic.k} onClick={()=>set({ icon:ic.e })} aria-label={ic.name} aria-pressed={selected}
                      style={{ height:48, borderRadius:10, background: selected ? '#2a2340' : '#1a1a24', border: selected ? '1px solid #fff' : '1px solid transparent', display:'grid', placeItems:'center', fontSize:18, cursor:'pointer', color:'#a78bfa', outline: selected ? '2px solid #7c4dff' : 'none', outlineOffset: selected ? '1px' : '0' }}>
                      <span style={{ filter: selected ? 'none' : 'grayscale(0.2)', opacity: selected ? 1 : 0.9 }}>{ic.e}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {editStep === 2 && (
            <div style={{ maxWidth:520, margin:'0 auto' }} onClick={ev=>ev.stopPropagation()}>
              <div style={{ color:'#fff', fontWeight:700, fontSize:15, marginBottom:18 }}>Select connection type and location</div>
              <div style={{ display:'grid', gap:18 }}>
                <Picker label="Type" value={e.typeLabel} icon="🌐"
                  options={PROFILE_TYPES.map(t=>({ value:t, label:t }))}
                  onChange={v=>{ set({ typeLabel:v }); setOpenMenu(null) }}
                  open={openMenu === 'type'} onToggle={()=>setOpenMenu(openMenu === 'type' ? null : 'type')} />
                <Picker label="Country" value={`${country.flag} ${country.name}`}
                  options={COUNTRIES.map(c=>({ value:c.code, label:c.name, icon:c.flag }))}
                  onChange={v=>{
                    const c = COUNTRIES.find(x=>x.code===v)!
                    set({ countryCode:c.code, countryName:c.name, flag:c.flag, city:'Fastest' })
                    setOpenMenu(null)
                  }}
                  open={openMenu === 'country'} onToggle={()=>setOpenMenu(openMenu === 'country' ? null : 'country')} />
                <Picker label="City" value={e.city} icon={e.city === 'Fastest' ? '⚡' : '📍'}
                  options={cityOptions}
                  onChange={v=>{ set({ city:v }); setOpenMenu(null) }}
                  open={openMenu === 'city'} onToggle={()=>setOpenMenu(openMenu === 'city' ? null : 'city')} />
              </div>
            </div>
          )}

          {editStep === 3 && (
            <div style={{ maxWidth:520, margin:'0 auto' }} onClick={ev=>ev.stopPropagation()}>
              <div style={{ color:'#fff', fontWeight:700, fontSize:15 }}>Configure profile settings</div>
              <div style={{ color:'#9ca3af', fontSize:11, marginTop:4, marginBottom:16 }}>These override your VPN settings while this profile is connected.</div>
              <div style={{ display:'grid', gap:16 }}>
                {settingRow('netShield','NetShield', e.netShield, ON_OFF.map(o=>({ value:o, label:o })), v=>set({ netShield:v as 'On'|'Off' }), 'Blocks malware, ads and trackers via DNS while connected.')}
                {settingRow('protocol','Protocol', e.protocol, PROTOCOL_OPTIONS.map(o=>({ value:o, label:o })), v=>set({ protocol:v as EditableProfile['protocol'] }), 'Stealth is the FortiGate-safe transport.')}
                {settingRow('nat','NAT type', e.natType, NAT_OPTIONS.map(o=>({ value:o, label:o })), v=>set({ natType:v as EditableProfile['natType'] }))}
                {settingRow('lan','LAN connections', e.lan, ON_OFF.map(o=>({ value:o, label:o })), v=>set({ lan:v as 'On'|'Off' }), 'Allow access to devices on your local network.')}
                {settingRow('connectGo','Connect and Go', e.connectAndGo, ON_OFF.map(o=>({ value:o, label:o })), v=>set({ connectAndGo:v as 'On'|'Off' }), 'Reconnect automatically when the network changes.')}
                {settingRow('dns','Custom DNS', e.customDNS, ON_OFF.map(o=>({ value:o, label:o })), v=>set({ customDNS:v as 'On'|'Off' }))}
                {e.customDNS === 'On' && (
                  <div>
                    <label htmlFor="custom-dns" style={{ color:'#e5e7eb', fontSize:11, fontWeight:600 }}>DNS server</label>
                    <input id="custom-dns" value={e.customDNSVal || ''} onChange={ev=>set({ customDNSVal: ev.target.value })} placeholder="1.1.1.1" inputMode="decimal"
                      style={{ width:'100%', marginTop:6, background:'#23222f', border:`1px solid ${(e.customDNSVal && !/^\d{1,3}(\.\d{1,3}){3}$/.test(e.customDNSVal.trim())) ? '#ef4444' : '#2a2a38'}`, borderRadius:10, padding:'12px 14px', color:'#fff', fontSize:13, outline:'none' }} />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div style={{ padding:'14px 16px', background:'#000', borderTop:'1px solid #1a1a24', display:'flex', gap:10, position:'sticky', bottom:0 }}>
          {editStep === 1 ? (
            <button onClick={closeWizard} style={{ flex:1, background:'#23222f', color:'#e5e7eb', border:'1px solid #2a2a38', padding:'12px', borderRadius:10, fontWeight:600, cursor:'pointer' }}>Cancel</button>
          ) : (
            <button onClick={wizardBack} style={{ flex:1, background:'#2a2a38', color:'#e5e7eb', border:'1px solid #3a3a4a', padding:'12px', borderRadius:10, fontWeight:600, cursor:'pointer' }}>Back</button>
          )}
          {editStep < 3 ? (
            <button onClick={()=>{
              if(editStep === 1 && !e.name.trim()){ setWizardError('Give your profile a name'); return }
              if(editStep === 2 && !e.countryCode){ setWizardError('Choose a country'); return }
              setWizardError(null); setOpenMenu(null); setEditStep(s=> (s+1) as any)
            }} style={{ flex:1, background:'#6d4aff', color:'#fff', border:0, padding:'12px', borderRadius:10, fontWeight:800, cursor:'pointer' }}>Next</button>
          ) : (
            <button onClick={saveEditing} style={{ flex:1, background:'#6d4aff', color:'#fff', border:0, padding:'12px', borderRadius:10, fontWeight:800, cursor:'pointer' }}>Save</button>
          )}
        </div>
      </div>
    )
  }

  /* ---------------- Profiles ---------------- */

  const ProfilesTab = () => (
    <div style={{ background:'#000', minHeight:'100%', paddingBottom:80 }}>
      <div style={{ padding:'16px 16px 0', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div style={{ color:'#fff', fontWeight:800, fontSize:18 }}>Profiles</div>
        <button onClick={()=>setInfoOpen(true)} style={{ background:'transparent', color:'#9ca3af', fontSize:11, border:'1px solid #2a2a38', padding:'4px 8px', borderRadius:999, cursor:'pointer' }}>Info ⓘ</button>
      </div>
      <div style={{ padding:8 }}>
        {editableProfiles.map(p=>{
          const active = connected && selectedProfile.id === p.id
          return (
            <div key={p.id} onClick={()=>openSheet(p)} style={{ display:'flex', alignItems:'center', gap:12, padding:'14px 12px', borderBottom:'1px solid #12121a', cursor:'pointer', background: active ? '#12121a' : 'transparent' }}>
              <div style={{ width:36, height:36, borderRadius:8, background:'#1e1b2e', display:'grid', placeItems:'center', fontSize:16, position:'relative', border:'1px solid #2a2a38' }}>
                <span style={{ color:'#a78bfa' }}>{p.icon}</span>
                {p.fast && <span style={{ position:'absolute', bottom:-4, right:-4, background:'#0ac47e', width:16, height:16, borderRadius:99, display:'grid', placeItems:'center', fontSize:9, border:'1px solid #000', color:'#fff' }}>⚡</span>}
                {p.flag && !p.fast && <span style={{ position:'absolute', bottom:-2, right:-2, background:'#1a1a24', borderRadius:4, padding:'1px 3px', fontSize:8, border:'1px solid #2a2a38' }}>{p.flag}</span>}
              </div>
              <div style={{ flex:1 }}>
                <div style={{ color:'#fff', fontWeight:700, fontSize:13, display:'flex', alignItems:'center', gap:6 }}>
                  {p.name} {active && <span style={{ width:8, height:8, background:'#0ac47e', borderRadius:999, boxShadow:'0 0 6px #0ac47e' }} />}
                </div>
                <div style={{ color:'#9ca3af', fontSize:11 }}>{p.subtitle}</div>
              </div>
              <button onClick={(ev)=>{ ev.stopPropagation(); openSheet(p) }} aria-label={`${p.name} options`} style={{ background:'transparent', border:0, color:'#6b7280', fontSize:16, cursor:'pointer', padding:'6px 8px' }}>⋯</button>
            </div>
          )
        })}
      </div>
      <div style={{ padding:'16px 12px 40px' }}>
        <button onClick={startCreate} style={{ width:'100%', background:'#6d4aff', color:'#fff', border:0, padding:'14px', borderRadius:12, fontWeight:800, cursor:'pointer' }}>Create profile</button>
        <div style={{ color:'#4b5563', fontSize:11, textAlign:'center', marginTop:8 }}>Profiles store country, NetShield, protocol and DNS. All of them ship with each release.</div>
      </div>
    </div>
  )

  /* ---------------- Settings ---------------- */

  const SettingsTab = () => {
    const notifSub = notifPerm === 'granted'
      ? 'On — connect and disconnect alerts go to your system notification centre'
      : notifPerm === 'denied'
        ? 'Blocked by the system — allow notifications for this site, then tap again'
        : 'Off — tap to ask the system for permission'
    return (
      <div style={{ background:'#000', minHeight:'100%', paddingBottom:80 }}>
        <div style={{ padding:'16px 16px 0' }}>
          <div style={{ color:'#fff', fontWeight:800, fontSize:18 }}>Settings</div>
          <div style={{ color:'#8b8da3', fontSize:11, marginTop:4 }}>Everything here changes how OpenPath behaves on this device.</div>
        </div>
        <div style={{ padding:'0 16px 16px' }}>

          <Section title="Connection">
            <div style={{ padding:'13px 14px' }}>
              <div style={{ color:'#e5e7eb', fontSize:13, fontWeight:600 }}>Protocol</div>
              <div style={{ color:'#8b8da3', fontSize:11, marginTop:2 }}>
                {vpnMode === 'stealth' ? 'Stealth — TLS inside TLS on TCP 443, survives FortiGate' : 'Turbo — plain WebSocket, lowest overhead, trusted networks only'}
              </div>
              <div style={{ marginTop:10, display:'flex', gap:6, background:'#0a0a0f', border:'1px solid #2a2a38', borderRadius:999, padding:3 }}>
                <button onClick={()=>chooseMode('stealth')} aria-pressed={vpnMode==='stealth'} style={{ flex:1, padding:'8px 10px', borderRadius:999, border:0, fontSize:12, fontWeight:700, cursor:'pointer', background: vpnMode === 'stealth' ? '#6d4aff' : 'transparent', color: vpnMode === 'stealth' ? '#fff' : '#9ca3af' }}>Stealth</button>
                <button onClick={()=>chooseMode('fast')} aria-pressed={vpnMode==='fast'} style={{ flex:1, padding:'8px 10px', borderRadius:999, border:0, fontSize:12, fontWeight:700, cursor:'pointer', background: vpnMode === 'fast' ? '#6d4aff' : 'transparent', color: vpnMode === 'fast' ? '#fff' : '#9ca3af' }}>Turbo</button>
              </div>
              {connected && <div style={{ color:'#0ac47e', fontSize:10, marginTop:6 }}>Switching protocol reconnects the tunnel automatically.</div>}
            </div>
            <div style={{ padding:'0 14px 13px' }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8 }}>
                <button onClick={()=>setTab('countries')} aria-label="Open server list" style={{ minWidth:0, textAlign:'left', background:'transparent', border:0, color:'inherit', cursor:'pointer', padding:0 }}>
                  <div style={{ color:'#e5e7eb', fontSize:12, fontWeight:600 }}>Server</div>
                  <div style={{ color:'#8b8da3', fontSize:11, fontFamily:'monospace', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{serverHost}</div>
                </button>
                <button onClick={()=>fetchHosts(true)} style={{ background:'#1a1a24', border:'1px solid #2a2a38', color:'#e5e7eb', padding:'6px 12px', borderRadius:8, cursor:'pointer', fontSize:11, flexShrink:0 }}>↻ Refresh</button>
              </div>
              <div style={{ color:'#8b8da3', fontSize:11, marginTop:6 }}>{hosts ? `${hosts.online} of ${hosts.total} servers online` : 'Server list not loaded yet'}</div>
            </div>
          </Section>

          <Section title="Notifications">
            <SettingRow
              icon="🔔"
              title={`System notifications: ${notifEnabled && notifPerm === 'granted' ? 'On' : 'Off'}`}
              sub={notifSub}
              right={<Toggle on={notifEnabled && notifPerm === 'granted'} />}
              onClick={toggleNotifications}
              last={!notifEnabled || notifPerm !== 'granted'}
            />
            {notifEnabled && notifPerm === 'granted' && (
              <SettingRow icon="🧪" title="Send a test notification" sub="Fires one real system notification"
                onClick={()=>{ fireSystemNotification('OpenPath VPN', 'Test notification — this is how connect and disconnect alerts look.'); notify('Test notification sent') }}
                last />
            )}
          </Section>

          <Section title="Profiles">
            <SettingRow icon="▭" title={`${editableProfiles.length} saved profiles`} sub="Edit, duplicate or delete them in Profiles" onClick={()=>setTab('profiles')} />
            <SettingRow icon="＋" title="Create profile" sub="Name, colour, icon, location and profile settings" onClick={startCreate} last />
          </Section>

          <Section title="App">
            <SettingRow
              icon="⬆"
              title="Releases"
              sub={releases?.length ? `Latest ${releases[0]?.tag_name || releases[0]?.name}` : 'Builds for Windows, macOS, Linux, Android, iOS'}
              onClick={()=>{ setTab('releases'); fetchReleases() }}
            />
            <SettingRow icon="⌥" title="Source code" sub="GitHub repository" onClick={()=>openExternal('https://github.com/mob5824m-wq/OpenPath-VPN')} />
            <SettingRow icon="🐞" title="Report an issue" sub="Opens a GitHub issue" onClick={()=>openExternal('https://github.com/mob5824m-wq/OpenPath-VPN/issues')} last />
          </Section>

          <Section title="Diagnostics">
            <SettingRow icon="</>" title="Connection log" sub={`${logs.length} events on this device`} right={<span>{showLogs ? 'Hide' : 'Show'}</span>} onClick={()=>setShowLogs(v=>!v)} last={!showLogs} />
            {showLogs && (
              <div style={{ padding:'0 14px 12px' }}>
                <div style={{ background:'#0a0a0f', border:'1px solid #2a2a38', borderRadius:8, padding:10, maxHeight:170, overflow:'auto', fontFamily:'JetBrains Mono, monospace', fontSize:10, color:'#9ca3af', whiteSpace:'pre-wrap', lineHeight:1.6 }}>
                  {logs.slice(-14).join('\n') || 'No events yet'}
                </div>
                <div style={{ display:'flex', gap:8, marginTop:8 }}>
                  <button onClick={()=>copyText(logs.join('\n'), 'Log copied')} style={{ background:'#1a1a24', border:'1px solid #2a2a38', color:'#e5e7eb', padding:'6px 12px', borderRadius:8, cursor:'pointer', fontSize:11 }}>Copy log</button>
                  <button onClick={()=>{ setLogs([`[${new Date().toLocaleTimeString()}] Log cleared`]); setShowLogs(false); notify('Log cleared') }} style={{ background:'#1a1a24', border:'1px solid #2a2a38', color:'#e5e7eb', padding:'6px 12px', borderRadius:8, cursor:'pointer', fontSize:11 }}>Clear</button>
                </div>
              </div>
            )}
          </Section>

          <Section title="About">
            <SettingRow icon="🛡️" title="OpenPath VPN 1.0.0" sub={`Web build • ${vpnMode === 'fast' ? 'Turbo' : 'Stealth'} transport • ${serverHost}`}
              right={<span>Copy</span>}
              onClick={()=>copyText(`OpenPath VPN 1.0.0\nmode=${vpnMode}\nserver=${serverUrlRaw}\nprofiles=${editableProfiles.length}\nuserAgent=${navigator.userAgent}`, 'Version info copied')} />
            <SettingRow icon="↺" title={confirmReset ? 'Tap again to confirm reset' : 'Reset local data'} sub="Deletes saved profiles, recents, feedback and protocol choice on this device"
              right="" onClick={resetLocal} last />
          </Section>

          <div style={{ marginTop:16, textAlign:'center', color:'#4b5563', fontSize:10 }}>
            {serverHost} • {hosts?.online ?? 0}/{hosts?.total ?? 0} servers • key hidden
          </div>
        </div>
      </div>
    )
  }

  /* ---------------- Releases ---------------- */

  const ReleasesTab = () => {
    const filter = PLATFORM_FILTERS.find(f=>f.id===releasePlatform) || PLATFORM_FILTERS[0]
    const visible = (releases || []).map(rel=>{
      const assets = (rel.assets || []).filter((a:any)=> filter.match(a.name))
      return { rel, assets }
    }).filter(x=> filter.id === 'all' || x.assets.length > 0)

    return (
      <div style={{ background:'#000', minHeight:'100%', paddingBottom:80 }}>
        <div style={{ padding:'16px 16px 8px' }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <button onClick={goBack} style={{ background:'transparent', border:'1px solid #2a2a38', color:'#e5e7eb', padding:'6px 10px', borderRadius:999, cursor:'pointer' }}>‹ Back</button>
            <div style={{ color:'#fff', fontWeight:800, fontSize:18 }}>Releases</div>
          </div>
          <div style={{ color:'#9ca3af', fontSize:11, marginTop:8 }}>Auto-tagged +0.1 on every merge to main. Each release captures apps and your profile set.</div>
          <div style={{ marginTop:10, display:'flex', gap:6, flexWrap:'wrap' }}>
            {PLATFORM_FILTERS.map(f=>(
              <button key={f.id} onClick={()=>setReleasePlatform(f.id)} aria-pressed={releasePlatform===f.id}
                style={{ background: releasePlatform===f.id ? '#6d4aff' : '#1a1a24', border:'1px solid '+(releasePlatform===f.id?'#6d4aff':'#2a2a38'), color:'#e5e7eb', padding:'5px 10px', borderRadius:999, fontSize:11, cursor:'pointer', fontWeight: releasePlatform===f.id?700:500 }}>{f.label}</button>
            ))}
          </div>
          <button onClick={()=>fetchReleases(true)} style={{ marginTop:10, background:'#1a1a24', border:'1px solid #2a2a38', color:'#a78bfa', padding:'6px 10px', borderRadius:8, cursor:'pointer', fontSize:11 }}>↻ Refresh from GitHub</button>
        </div>
        <div style={{ padding:'12px', display:'grid', gap:10 }}>
          {releasesLoading && <div style={{ color:'#9ca3af', textAlign:'center', padding:20 }}>Loading releases…</div>}
          {releases && releases.length === 0 && (
            <div style={{ background:'#1c1b26', border:'1px solid #2a2a38', borderRadius:12, padding:14, color:'#9ca3af', fontSize:11, textAlign:'center' }}>
              No releases yet. Merge to main to bump v1.0 → v1.1.
            </div>
          )}
          {releases && releases.length > 0 && visible.length === 0 && (
            <div style={{ background:'#1c1b26', border:'1px solid #2a2a38', borderRadius:12, padding:14, color:'#9ca3af', fontSize:11, textAlign:'center' }}>
              No {filter.label} assets in the published releases yet.
            </div>
          )}
          {visible.map(({ rel, assets })=>(
            <div key={rel.id || rel.tag_name} style={{ background:'#12121a', border:'1px solid #1f1f2a', borderRadius:12, padding:12 }}>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <span style={{ background:'#6d4aff', color:'#fff', padding:'3px 8px', borderRadius:999, fontSize:11, fontWeight:700 }}>{rel.tag_name || rel.name}</span>
                <span style={{ color:'#e5e7eb', fontSize:12, fontWeight:700, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{rel.name || rel.tag_name}</span>
                <span style={{ marginLeft:'auto', color:'#6b7280', fontSize:10, flexShrink:0 }}>{rel.published_at ? new Date(rel.published_at).toLocaleDateString() : ''}</span>
              </div>
              <div style={{ color:'#9ca3af', fontSize:11, marginTop:6, whiteSpace:'pre-wrap', lineHeight:1.5 }}>{rel.body ? rel.body.slice(0, 320) : 'Release with installers and profile updates.'}</div>
              <div style={{ marginTop:8, display:'flex', gap:6, flexWrap:'wrap' }}>
                {assets.slice(0, 8).map((a:any)=>(
                  <a key={a.id} href={a.browser_download_url} target="_blank" rel="noreferrer"
                    style={{ background:'#1a1a24', border:'1px solid #2a2a38', color:'#a78bfa', padding:'4px 8px', borderRadius:999, fontSize:10, textDecoration:'none' }}>{a.name} ⬇</a>
                ))}
                {assets.length === 0 && <span style={{ color:'#6b7280', fontSize:10 }}>{filter.id === 'all' ? 'No assets attached to this release' : `No ${filter.label} asset here`}</span>}
              </div>
              <button onClick={()=>openExternal(rel.html_url)} style={{ marginTop:8, background:'transparent', border:'1px solid #2a2a38', color:'#9ca3af', padding:'4px 10px', borderRadius:999, fontSize:10, cursor:'pointer' }}>Open on GitHub ↗</button>
            </div>
          ))}
          {!releases && !releasesLoading && (
            <div style={{ background:'#12121a', border:'1px solid #1f1f2a', borderRadius:12, padding:14 }}>
              <div style={{ color:'#e5e7eb', fontWeight:700, fontSize:12 }}>Releases for apps and profiles</div>
              <div style={{ color:'#9ca3af', fontSize:11, marginTop:6 }}>Every merge to main bumps the tag (v1.0 → v1.1). The release workflow builds server, web, Linux GUI/CLI, Windows NSIS, macOS DMG, Android APK and the iOS extension.</div>
              <button onClick={()=>fetchReleases(true)} style={{ marginTop:10, background:'#6d4aff', color:'#fff', border:0, padding:'10px 14px', borderRadius:8, fontWeight:700, cursor:'pointer', fontSize:12 }}>Load GitHub releases</button>
            </div>
          )}
          <div style={{ background:'#0f0f14', border:'1px solid #1f1f2a', borderRadius:12, padding:12 }}>
            <div style={{ color:'#e5e7eb', fontWeight:700, fontSize:12 }}>Profiles in this build</div>
            <div style={{ color:'#9ca3af', fontSize:11, marginTop:4 }}>Tap a profile to edit it. Profile sets are snapshotted with every release tag.</div>
            <div style={{ marginTop:8, display:'grid', gap:6 }}>
              {editableProfiles.map(p=>(
                <button key={p.id} onClick={()=>openSheet(p)} style={{ display:'flex', alignItems:'center', gap:8, background:'#1a1a24', border:'1px solid #2a2a38', borderRadius:8, padding:'8px 10px', cursor:'pointer', color:'inherit', textAlign:'left' }}>
                  <span style={{ color:'#a78bfa' }}>{p.icon}</span>
                  <span style={{ color:'#e5e7eb', fontSize:12, fontWeight:600 }}>{p.name}</span>
                  <span style={{ color:'#9ca3af', fontSize:10, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>• {p.countryName} • {p.city} • {p.protocol}</span>
                  <span style={{ marginLeft:'auto', color:'#6b7280', fontSize:10 }}>v1</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  /* ---------------- Bottom nav ---------------- */

  const BottomNav = () => (
    <div style={{ position:'fixed', bottom:0, left:0, right:0, height:58, background:'#12101d', borderTop:'1px solid #1f1f2a', display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', alignItems:'center', padding:'0 8px', zIndex:20 }}>
      {[
        { id:'home', label:'Home', icon:'⌂' },
        { id:'countries', label:'Countries', icon:'◍' },
        { id:'profiles', label:'Profiles', icon:'▭' },
        { id:'settings', label:'Settings', icon:'⚙' },
      ].map(it=>{
        const active = tab === it.id
        return (
          <button key={it.id} onClick={()=>setTab(it.id as Tab)} aria-label={it.label} aria-current={active ? 'page' : undefined}
            style={{ background:'transparent', border:0, cursor:'pointer', display:'flex', flexDirection:'column', alignItems:'center', gap:2, color: active ? '#a78bfa' : '#6b7280' }}>
            <span style={{ width:32, height:26, borderRadius:999, background: active ? '#6d4aff' : 'transparent', display:'grid', placeItems:'center', color: active ? '#fff' : '#6b7280', fontSize:14 }}>{it.icon}</span>
            <span style={{ fontSize:10, fontWeight: active ? 700 : 500 }}>{it.label}</span>
          </button>
        )
      })}
    </div>
  )

  /* ---------------- Root render ---------------- */

  return (
    <div style={{ fontFamily:'Inter, system-ui, sans-serif', background:'#000', minHeight:'100vh', color:'#e5e7eb', display:'flex', flexDirection:'column', maxWidth:440, margin:'0 auto', borderLeft:'1px solid #1a1a24', borderRight:'1px solid #1a1a24', position:'relative' }}>
      <style>{`@keyframes pulse{0%{transform:scale(0.8);opacity:0.8}100%{transform:scale(1.6);opacity:0}} @keyframes slideUp{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}`}</style>
      {TopChrome()}
      <div style={{ flex:1, overflow:'auto', WebkitOverflowScrolling:'touch' as any }}>
        {tab === 'home' && HomeTab()}
        {tab === 'countries' && CountriesTab()}
        {tab === 'profiles' && ProfilesTab()}
        {tab === 'settings' && SettingsTab()}
        {tab === 'releases' && ReleasesTab()}
      </div>
      {BottomNav()}
      {sheetProfile && ProfileSheet()}
      {editing && EditWizard()}

      {/* NetShield picker */}
      <Sheet open={shieldOpen} onClose={()=>setShieldOpen(false)} title="NetShield">
        <div style={{ color:'#9ca3af', fontSize:12, marginBottom:12 }}>Blocks malware, ads and trackers by filtering DNS on the device. Applies to the whole VPN, and a profile can override it.</div>
        {SHIELD_OPTIONS.map(opt=>(
          <button key={opt} onClick={()=>{ setShieldMode(opt); setShieldOpen(false); notify(`NetShield: ${opt}`); log(`NetShield → ${opt}`) }}
            style={{ width:'100%', textAlign:'left', background: opt===shieldMode ? '#2a2340' : '#1a1a24', border:'1px solid '+(opt===shieldMode?'#7c4dff':'#2a2a38'), borderRadius:10, padding:'13px 14px', marginBottom:8, color:'#e5e7eb', fontSize:13, cursor:'pointer', display:'flex', alignItems:'center', gap:10 }}>
            <span>{opt === 'Off' ? '○' : opt === 'Block malware' ? '🛡️' : '🧱'}</span>
            <span>{opt}</span>
            {opt===shieldMode && <span style={{ marginLeft:'auto', color:'#a78bfa' }}>✓</span>}
          </button>
        ))}
        <div style={{ color:'#6b7280', fontSize:11, marginTop:4 }}>Saved on this device. Active profile override only applies while that profile is connected.</div>
      </Sheet>

      {/* Profiles info */}
      <Sheet open={infoOpen} onClose={()=>setInfoOpen(false)} title="About profiles">
        <div style={{ color:'#e5e7eb', fontSize:12, lineHeight:1.7 }}>
          <p style={{ margin:'0 0 10px' }}>A profile stores an exit country, a connection type, NetShield, protocol, NAT type, LAN access, Connect&nbsp;and&nbsp;Go and a custom DNS server.</p>
          <p style={{ margin:'0 0 10px' }}>Tap a profile to open its details, then Edit to change name, colour, icon and settings. Duplicate makes a copy you can tweak; Delete removes it from this device.</p>
          <p style={{ margin:'0 0 10px' }}>Your profile set is saved locally and is captured with every GitHub release tag, so you can always go back to a known-good set.</p>
        </div>
        <button onClick={()=>{ setInfoOpen(false); setTab('releases'); fetchReleases() }}
          style={{ marginTop:10, width:'100%', background:'#6d4aff', color:'#fff', border:0, padding:'12px', borderRadius:10, fontWeight:800, cursor:'pointer' }}>Open releases</button>
      </Sheet>

      {toast && (
        <div role="status" aria-live="polite"
          style={{ position:'fixed', left:'50%', bottom:76, transform:'translateX(-50%)', background:'#2a2a38', border:'1px solid #3a3a4a', color:'#fff', padding:'10px 16px', borderRadius:999, fontSize:12, zIndex:80, boxShadow:'0 8px 24px rgba(0,0,0,0.55)', maxWidth:'90%', textAlign:'center' }}>
          {toast}
        </div>
      )}
    </div>
  )
}
