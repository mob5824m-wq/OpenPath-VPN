import React, { useEffect, useRef, useState } from 'react'
import { countryFlag, countryName, defaultServerUrl, directoryTargets, directoryUrl, modeUrl, parseServerUrl, selectProfileServer } from './connection'
import type { HostDirectory, Mode, ServerTarget } from './connection'
import { loadReleaseFeed, PLATFORM_FILTERS } from './releases'
import type { Release } from './releases'
import DeviceVpnPanel from './DeviceVpnPanel'
import type { DeviceVpnBridge } from './DeviceVpnPanel'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type Tab = 'home' | 'countries' | 'profiles' | 'settings' | 'releases'
type ProfileRow = { id:string; name:string; subtitle:string; icon:string; color:string; flag?:string; fast?:boolean; connected?:boolean }

type EditableProfile = ProfileRow & {
  typeLabel: string
  countryCode: string
  countryName: string
  city: string
  netShield: 'On'|'Off'
  protocol: 'Stealth'|'Smart (auto)'|'Turbo'|'WireGuard'|'Stealth (Fortinet)'
  natType: 'Type 1'|'Type 2'|'Type 3'
  lan: 'On'|'Off'
  connectAndGo: 'On'|'Off'
  customDNS: 'On'|'Off'
  customDNSVal?: string
}

type GeoPoint = { lat:number; lon:number; city:string; country:string; source:'gps'|'default' }
type RecentEntry = { profileId:string; name:string; flag:string; city:string; country:string; mode:Mode; at:number; serverUrl?:string; serverName?:string }
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
  { id:'gaming', name:'Gaming', subtitle:'Any available server', icon:'🎮', color:'#1a1a24', flag:undefined, fast:true, typeLabel:'Standard', countryCode:'AUTO', countryName:'Any available server', city:'Fastest', netShield:'On', protocol:'Smart (auto)', natType:'Type 2', lan:'On', connectAndGo:'Off', customDNS:'Off' },
  { id:'anti-censorship', name:'Anti-censorship', subtitle:'Any available server', icon:'🕶️', color:'#1a1a24', fast:true, typeLabel:'Standard', countryCode:'AUTO', countryName:'Any available server', city:'Fastest', netShield:'On', protocol:'Stealth', natType:'Type 3', lan:'Off', connectAndGo:'Off', customDNS:'Off' },
  { id:'school', name:'School', subtitle:'Any available server', icon:'💼', color:'#7c4dff', flag:'🌐', typeLabel:'Standard', countryCode:'AUTO', countryName:'Any available server', city:'Fastest', netShield:'On', protocol:'Stealth', natType:'Type 3', lan:'Off', connectAndGo:'Off', customDNS:'Off' },
  { id:'home', name:'Home', subtitle:'Any available server', icon:'⚡', color:'#1a1a24', fast:true, typeLabel:'Standard', countryCode:'AUTO', countryName:'Any available server', city:'Fastest', netShield:'On', protocol:'Smart (auto)', natType:'Type 3', lan:'On', connectAndGo:'Off', customDNS:'Off' },
]

// Approximate map positions, used only when a server operator supplies a country.
const COUNTRY_COORDS:Record<string,{name:string;lat:number;lon:number}> = {
  CA:{name:'Canada',lat:45.4215,lon:-75.6972}, US:{name:'United States',lat:39.8283,lon:-98.5795},
  GB:{name:'United Kingdom',lat:51.5074,lon:-0.1278}, CH:{name:'Switzerland',lat:47.3769,lon:8.5417},
  DE:{name:'Germany',lat:50.1109,lon:8.6821}, NL:{name:'Netherlands',lat:52.3676,lon:4.9041},
  JP:{name:'Japan',lat:35.6762,lon:139.6503}, IS:{name:'Iceland',lat:64.1466,lon:-21.9426},
  AU:{name:'Australia',lat:-33.8688,lon:151.2093}, FR:{name:'France',lat:48.8566,lon:2.3522},
}

const FALLBACK_LOCATION: GeoPoint = { lat:0, lon:0, city:'', country:'Unknown', source:'default' }

const PROTOCOL_OPTIONS: EditableProfile['protocol'][] = ['Smart (auto)','Stealth','Turbo']
const QUICK_PROFILE: EditableProfile = { ...DEFAULT_EDITABLE[3], id:'quick-connect', name:'Quick Connect' }


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
      if(!Array.isArray(arr)) throw new Error('Invalid profiles')
      // Only merge fields for profiles that still exist; deleted defaults must stay deleted.
      return arr.filter(p=>p && typeof p.id === 'string').map(p=>{
        const defaults = DEFAULT_EDITABLE.find(d=>d.id === p.id) || QUICK_PROFILE
        return { ...defaults, ...p }
      })
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

function Picker({ label, value, selectedValue, options, onChange, open, onToggle, icon }:
  { label?:string; value:string; selectedValue?:string; options:MenuOption[]; onChange:(v:string)=>void; open:boolean; onToggle:()=>void; icon?:string }){
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
              style={{ width:'100%', textAlign:'left', background: o.value===(selectedValue ?? value) ? '#2a2340' : 'transparent', border:0, borderBottom:'1px solid #23222f', color:'#e5e7eb', padding:'11px 14px', fontSize:13, cursor:'pointer', display:'flex', alignItems:'center', gap:8 }}>
              {o.icon && <span>{o.icon}</span>}
              <span>{o.label}</span>
              {o.value===(selectedValue ?? value) && <span style={{ marginLeft:'auto', color:'#a78bfa' }}>✓</span>}
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
  const deviceBridge = (window as any).openpath?.deviceVpn as DeviceVpnBridge | undefined
  const [serverUrlRaw, setServerUrlRaw] = useState(()=>{
    const saved = readJSON<string|null>('openpath:serverUrl', null)
    if(saved) return saved
    return defaultServerUrl(location)
  })
  // The key is intentionally not persisted; it is only held in memory for this tab.
  const [psk, setPsk] = useState('demo-student-key-do-not-use-prod')
  const [user, setUser] = useState(()=>readJSON<string>('openpath:user', 'demo'))
  const [vpnMode, setVpnMode] = useState<Mode>(()=> readJSON<Mode>('openpath:mode', 'stealth'))
  const [tab, setTabState] = useState<Tab>('home')
  const tabRef = useRef<Tab>('home')
  const [tabHistory, setTabHistory] = useState<Tab[]>([])

  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [editableProfiles, setEditableProfiles] = useState<EditableProfile[]>(()=>loadEditable())
  const [selectedProfile, setSelectedProfile] = useState<EditableProfile>(()=>
    editableProfiles.find(p=>p.id === readJSON('openpath:selectedProfileId', 'school')) || editableProfiles[0] || QUICK_PROFILE)
  const [activeServer, setActiveServer] = useState<ServerTarget|null>(null)
  const [activeMode, setActiveMode] = useState<Mode>('stealth')
  const [hosts, setHosts] = useState<HostDirectory|null>(null)
  const [hostsLoading, setHostsLoading] = useState(false)
  const [hostsError, setHostsError] = useState<string|null>(null)
  const [directoryFor, setDirectoryFor] = useState('')
  const hostsRequestRef = useRef(0)
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
  const connectTimer = useRef<ReturnType<typeof setTimeout>|null>(null)
  const pingTimer = useRef<ReturnType<typeof setInterval>|null>(null)
  const attemptRef = useRef(0)
  const targetRef = useRef<ServerTarget|null>(null)
  const pendingProfileRef = useRef<EditableProfile|null>(null)
  const pendingFetch = useRef<{ id:string; timer:ReturnType<typeof setTimeout> }|null>(null)
  const rxRef = useRef(0)
  const txRef = useRef(0)

  // Notifications (OS only)
  const [notifPerm, setNotifPerm] = useState<string>(notificationPermission())
  const [notifEnabled, setNotifEnabled] = useState<boolean>(()=> readJSON<boolean>('openpath:notifications', true))

  // Editable profiles + sheet + wizard
  const [sheetProfile, setSheetProfile] = useState<EditableProfile|null>(null)
  const [editing, setEditing] = useState<EditableProfile|null>(null)
  const [editStep, setEditStep] = useState<1|2|3>(1)
  const [wizardError, setWizardError] = useState<string|null>(null)
  const [openMenu, setOpenMenu] = useState<string|null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Releases
  const [releases, setReleases] = useState<Release[]|null>(null)
  const [releasesLoading, setReleasesLoading] = useState(false)
  const [releasesError, setReleasesError] = useState<string|null>(null)
  const [releasesWarning, setReleasesWarning] = useState<string|null>(null)
  const [releasesSource, setReleasesSource] = useState<'server'|'github'|null>(null)
  const releaseAbortRef = useRef<AbortController|null>(null)
  const [releasePlatform, setReleasePlatform] = useState<string>('all')

  // Settings state (kept at App level so it survives re-renders)
  const [showLogs, setShowLogs] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)

  // Home state
  const [shieldOpen, setShieldOpen] = useState(false)
  const [recents, setRecents] = useState<RecentEntry[]>(()=> readJSON<RecentEntry[]>('openpath:recents', []))
  const [feedback, setFeedback] = useState<'up'|'down'|null>(()=> readJSON<'up'|'down'|null>('openpath:feedback', null))
  const [infoOpen, setInfoOpen] = useState(false)
  const [fetchUrl, setFetchUrl] = useState('https://api.github.com/')
  const [fetching, setFetching] = useState(false)
  const [fetchResult, setFetchResult] = useState<{status:number; body:string; truncated:boolean}|null>(null)

  // Toast
  const [toast, setToast] = useState<string|null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout>|null>(null)
  const resetTimer = useRef<ReturnType<typeof setTimeout>|null>(null)
  const notify = (msg:string)=>{
    setToast(msg)
    if(toastTimer.current) clearTimeout(toastTimer.current)
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
  useEffect(()=>{ writeJSON('openpath:user', user) },[user])
  useEffect(()=>{ writeJSON('openpath:selectedProfileId', selectedProfile.id) },[selectedProfile])
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

  // The server sees the address of the request (which can be a reverse proxy).
  useEffect(()=>{
    let cancelled=false
    ;(async()=>{
      try{
        const r = await fetch('/api/client-ip')
        if(!r.ok) throw new Error('IP unavailable')
        const d = await r.json()
        if(!cancelled) setClientIp(typeof d.ip === 'string' ? d.ip : '')
      }catch{ if(!cancelled) setClientIp('') }
      finally { if(!cancelled) setClientIpLoading(false) }
    })()
    return ()=>{ cancelled=true }
  },[])

  // Never send the user's IP to a third-party geolocation service. Use GPS only
  // if permission was already granted; otherwise the location is unknown.
  useEffect(()=>{
    let cancelled=false
    ;(async()=>{
      try{
        if(navigator.geolocation && navigator.permissions){
          const perm = await navigator.permissions.query({ name:'geolocation' })
          if(perm.state === 'granted') navigator.geolocation.getCurrentPosition(
            pos=>{ if(!cancelled) setMyLocation({ lat:pos.coords.latitude, lon:pos.coords.longitude, city:'Your location', country:'Device GPS', source:'gps' }) },
            ()=>{}, { timeout:4000, maximumAge:600000 },
          )
        }
      }catch{}
    })()
    return ()=>{ cancelled=true }
  },[])

  useEffect(()=>()=>{
    attemptRef.current++
    if(connectTimer.current) clearTimeout(connectTimer.current)
    if(pingTimer.current) clearInterval(pingTimer.current)
    if(pendingFetch.current) clearTimeout(pendingFetch.current.timer)
    if(toastTimer.current) clearTimeout(toastTimer.current)
    if(resetTimer.current) clearTimeout(resetTimer.current)
    releaseAbortRef.current?.abort()
    const ws = wsRef.current
    wsRef.current = null
    if(ws){ ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null; try{ ws.close() }catch{} }
  },[])

  /* ---------------- data ---------------- */

  let currentDirectory = ''
  try{ currentDirectory = directoryUrl(serverUrlRaw) }catch{}
  const targets = directoryFor && directoryFor === currentDirectory ? directoryTargets(hosts, serverUrlRaw) : []

  const fetchHosts = async (announce = false)=>{
    const requestId = ++hostsRequestRef.current
    setHostsLoading(true)
    setHostsError(null)
    try{
      const address = directoryUrl(serverUrlRaw)
      if(location.protocol === 'https:' && address.startsWith('http:')) throw new Error('An HTTPS page cannot load an insecure server directory')
      const res = await fetch(address, { signal: AbortSignal.timeout(8000) })
      if(!res.ok) throw new Error(`Server returned HTTP ${res.status}`)
      const d:HostDirectory = await res.json()
      if(!d.main || !Array.isArray(d.hosts)) throw new Error('Invalid server directory response')
      if(requestId !== hostsRequestRef.current) return
      setHosts(d)
      setDirectoryFor(address)
      log(`Directory: ${d.online} registered servers online`)
      if(announce) notify(`Server list refreshed: ${d.online} registered servers online`)
    }catch(e:any){
      if(requestId !== hostsRequestRef.current) return
      const message = e?.message || 'Could not reach the server list'
      setHostsError(message)
      setHosts(null)
      setDirectoryFor('')
      log(`Server list failed: ${message}`)
      if(announce) notify(`Could not refresh server list: ${message}`)
    }finally{ if(requestId === hostsRequestRef.current) setHostsLoading(false) }
  }
  useEffect(()=>{ fetchHosts() },[])

  const fetchReleases = async (force = false)=>{
    if(releases && !force) return
    releaseAbortRef.current?.abort()
    const controller = new AbortController()
    releaseAbortRef.current = controller
    setReleasesLoading(true)
    setReleasesError(null)
    setReleasesWarning(null)
    try{
      const feed = await loadReleaseFeed(force, controller.signal)
      if(controller.signal.aborted) return
      setReleases(feed.releases)
      setReleasesSource(feed.source)
      setReleasesWarning(feed.stale ? (feed.warning || 'Showing cached releases because GitHub could not be reached') : null)
      if(force) notify(feed.stale ? 'Showing cached releases' : 'Releases refreshed')
    }catch(e:any){
      if(controller.signal.aborted) return
      setReleasesError(e?.message || 'Could not reach GitHub')
      if(force) notify('Could not refresh GitHub releases')
    }finally{
      if(releaseAbortRef.current === controller){ releaseAbortRef.current = null; setReleasesLoading(false) }
    }
  }

  /* ---------------- connection ---------------- */

  const addRecent = (p: EditableProfile, mode: Mode, target:ServerTarget)=>{
    const name = target.country ? countryName(target.country) : 'Location unknown'
    const entry: RecentEntry = { profileId:p.id, name:p.name, flag:target.flag, city:target.region || target.name, country:name, mode, at:Date.now(), serverUrl:target.url, serverName:target.name }
    setRecents(prev=>{
      const next = [entry, ...prev.filter(r=> !(r.profileId===entry.profileId && r.mode===entry.mode && r.serverUrl===entry.serverUrl))].slice(0,6)
      writeJSON('openpath:recents', next)
      return next
    })
  }

  const clearPendingFetch = ()=>{
    if(pendingFetch.current) clearTimeout(pendingFetch.current.timer)
    pendingFetch.current = null
    setFetching(false)
  }
  const closeSocket = ()=>{
    attemptRef.current++
    if(connectTimer.current) clearTimeout(connectTimer.current)
    if(pingTimer.current) clearInterval(pingTimer.current)
    connectTimer.current = null
    pingTimer.current = null
    clearPendingFetch()
    const ws = wsRef.current
    wsRef.current = null
    targetRef.current = null
    pendingProfileRef.current = null
    if(ws){
      ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null
      try{ ws.close() }catch{}
    }
    setConnected(false)
    setConnecting(false)
    setActiveServer(null)
    setStartedAt(null)
    setRx(0); setTx(0); setRtt(0)
    rxRef.current = 0; txRef.current = 0
  }

  const sendMessage = (ws:WebSocket, message:unknown)=>{
    const data = JSON.stringify(message)
    ws.send(data)
    txRef.current += new TextEncoder().encode(data).byteLength
    setTx(txRef.current)
  }

  const connect = async (override?:ServerTarget, profile?:EditableProfile, modeArg?:Mode)=>{
    const prof = profile || selectedProfile
    let mode:Mode = modeArg || vpnMode
    if(!modeArg && profile){
      if(prof.protocol === 'Stealth') mode = 'stealth'
      else if(prof.protocol === 'Turbo') mode = 'fast'
      else if(prof.protocol !== 'Smart (auto)'){
        notify(`${prof.protocol} is not available in the web client. Edit the profile to choose a supported transport.`)
        return
      }
    }
    let target:ServerTarget, u:URL
    try{
      target = override || selectProfileServer(targets, serverUrlRaw, prof)
      u = modeUrl(target.url, mode)
      if(location.protocol === 'https:' && u.protocol !== 'wss:') throw new Error('Use wss:// from an HTTPS page')
      if(!user.trim() || !psk) throw new Error('Enter a username and PSK in Settings')
    }catch(e:any){ notify(e.message || 'Invalid server address'); log(`Connection not started: ${e.message}`); return }

    // Invalidate any pending HMAC/open callbacks before starting the new attempt.
    closeSocket()
    const attempt = ++attemptRef.current
    targetRef.current = target
    pendingProfileRef.current = prof
    setConnecting(true)
    setFetchResult(null)
    log(`Connecting to ${u.host}${u.pathname} (${mode === 'fast' ? 'Turbo' : 'Stealth'})`)

    let token:string
    try{ token = await buildAuthTokenAsync(psk, u.pathname) }
    catch(e:any){
      if(attempt === attemptRef.current){ closeSocket(); log(`HMAC failed: ${e.message}`); notify('Could not sign the connection request') }
      return
    }
    if(attempt !== attemptRef.current) return
    u.searchParams.set('auth', token)
    u.searchParams.set('user', user.trim())

    let ws:WebSocket
    try{ ws = new WebSocket(u.toString()) }
    catch(e:any){
      if(attempt === attemptRef.current){ closeSocket(); log(`Connection failed: ${e.message}`); notify(`Connection failed: ${e.message}`) }
      return
    }
    ws.binaryType = 'arraybuffer'
    wsRef.current = ws
    let opened = false
    connectTimer.current = setTimeout(()=>{
      if(attempt === attemptRef.current && !opened){
        log('Connection timed out after 8s')
        closeSocket()
        notify('Connection timed out — check the server address')
      }
    }, 8000)

    ws.onopen = ()=>{
      if(attempt !== attemptRef.current || wsRef.current !== ws){ try{ ws.close() }catch{}; return }
      opened = true
      if(connectTimer.current) clearTimeout(connectTimer.current)
      connectTimer.current = null
      rxRef.current = 0; txRef.current = 0
      setRx(0); setTx(0); setRtt(0)
      setStartedAt(Date.now())
      setConnecting(false); setConnected(true)
      setSelectedProfile(prof)
      setActiveServer(target)
      setActiveMode(mode)
      setVpnMode(mode)
      log(`Session connected to ${target.name} (${u.host})`)
      try{ sendMessage(ws, { op:'ping', t:Date.now() }) }catch{}
      pingTimer.current = setInterval(()=>{
        if(wsRef.current === ws && ws.readyState === WebSocket.OPEN){
          try{ sendMessage(ws, { op:'ping', t:Date.now() }) }catch{}
        }
      }, 15000)
      addRecent(prof, mode, target)
      if(tabRef.current === 'countries') setTab('home')
      fireSystemNotification('OpenPath • Session connected', `${target.name} • ${mode === 'fast' ? 'Turbo' : 'Stealth'}. Device traffic is not routed by the web app.`)
    }
    ws.onmessage = (ev)=>{
      if(wsRef.current !== ws) return
      const len = typeof ev.data === 'string' ? new TextEncoder().encode(ev.data).byteLength : (ev.data as ArrayBuffer).byteLength
      rxRef.current += len
      try{
        const txt = typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data as ArrayBuffer)
        const msg = JSON.parse(txt)
        if(msg.t === 'hello') log(`Server hello ${String(msg.id).slice(0,6)}…`)
        if(msg.op === 'pong' && typeof msg.t === 'number') setRtt(Math.max(0, Date.now() - msg.t))
        if(msg.op === 'fetch-res' && pendingFetch.current?.id === msg.id){
          clearPendingFetch()
          try{
            if(typeof msg.status !== 'number' || typeof msg.body !== 'string') throw new Error('Invalid response')
            const bytes = Uint8Array.from(atob(msg.body), c=>c.charCodeAt(0))
            setFetchResult({ status:msg.status, body:new TextDecoder().decode(bytes), truncated:!!msg.truncated })
            log(`Server fetch returned HTTP ${msg.status}`)
          }catch{
            log('Server returned an invalid fetch response')
            notify('Server returned an invalid fetch response')
          }
        }
      }catch{}
      setRx(rxRef.current)
    }
    ws.onerror = ()=>{ if(wsRef.current === ws) log('Transport error — check the server address and credentials') }
    ws.onclose = (e)=>{
      if(wsRef.current !== ws) return
      const message = opened ? `Session closed (${e.code})` : `Connection failed (${e.code}) — check the server address and credentials`
      closeSocket()
      log(message)
      notify(message)
      if(opened) fireSystemNotification('OpenPath • Session disconnected', 'The web session has closed.')
    }
  }

  const disconnect = ()=>{
    if(!wsRef.current && !connecting){ notify('Not connected'); return }
    log('Disconnect requested')
    closeSocket()
    fireSystemNotification('OpenPath • Session disconnected', 'The web session has closed.')
    notify('Disconnected')
  }

  const chooseMode = (mode:Mode)=>{
    if(mode === vpnMode) return
    setVpnMode(mode)
    log(`Transport selected: ${mode === 'fast' ? 'Turbo' : 'Stealth'}`)
    if(connected || connecting){
      void connect(targetRef.current || undefined, pendingProfileRef.current || selectedProfile, mode)
    }else notify(`${mode === 'fast' ? 'Turbo' : 'Stealth'} transport selected`)
  }

  const fetchViaServer = ()=>{
    const ws = wsRef.current
    if(!ws || ws.readyState !== WebSocket.OPEN){ notify('Connect to a server first'); return }
    try{
      const url = new URL(fetchUrl.trim())
      if(!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Enter an HTTP(S) URL without credentials')
    }catch(e:any){ notify(e.message || 'Enter a valid HTTP(S) URL'); return }
    clearPendingFetch()
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    setFetchResult(null)
    setFetching(true)
    pendingFetch.current = { id, timer:setTimeout(()=>{
      if(pendingFetch.current?.id === id){ pendingFetch.current = null; setFetching(false); notify('Server request timed out') }
    }, 15000) }
    try{ sendMessage(ws, { op:'fetch', id, url:fetchUrl.trim(), method:'GET' }) }
    catch{ clearPendingFetch(); notify('Could not send the request') }
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
      id:`custom-${Date.now()}-${Math.random().toString(36).slice(2,8)}`, name:'', subtitle:'Any available server', icon:'⭐', color:'#7c4dff', flag:'🌐',
      typeLabel:'Standard', countryCode:'AUTO', countryName:'Any available server', city:'Fastest',
      netShield:'Off', protocol:'Smart (auto)', natType:'Type 3', lan:'Off', connectAndGo:'Off', customDNS:'Off',
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
    const chosenCountry = countryName(editing.countryCode)
    const subtitle = editing.city !== 'Fastest' ? `${chosenCountry} · ${editing.city}` : chosenCountry
    const updated: EditableProfile = {
      ...editing, name, flag:countryFlag(editing.countryCode), countryName:chosenCountry, subtitle,
    }
    setEditableProfiles(prev=> prev.some(x=>x.id===updated.id) ? prev.map(x=> x.id===updated.id ? updated : x) : [...prev, updated])
    if(selectedProfile.id === updated.id) setSelectedProfile(updated)
    setEditing(null)
    setOpenMenu(null)
    setWizardError(null)
    log(`Saved profile “${updated.name}”`)
    notify(connected && selectedProfile.id === updated.id ? `Profile “${updated.name}” saved — reconnect to apply` : `Profile “${updated.name}” saved`)
    fireSystemNotification(`Profile saved: ${updated.name}`, `${updated.countryName} • ${updated.city} • ${updated.protocol}`)
  }
  const duplicateProfile = (p: EditableProfile)=>{
    const dup: EditableProfile = { ...p, id:`custom-${Date.now()}-${Math.random().toString(36).slice(2,8)}`, name:`${p.name} copy` }
    setEditableProfiles(prev=> [...prev, dup])
    log(`Duplicated “${p.name}”`)
    notify(`Duplicated “${p.name}”`)
    closeSheet()
  }
  const deleteProfile = (p: EditableProfile)=>{
    if(!confirmDelete){ setConfirmDelete(true); return }
    const remaining = editableProfiles.filter(x=>x.id!==p.id)
    setEditableProfiles(remaining)
    const nextRecents = recents.filter(r=>r.profileId !== p.id)
    setRecents(nextRecents)
    writeJSON('openpath:recents', nextRecents)
    if(selectedProfile.id === p.id || pendingProfileRef.current?.id === p.id){
      if(connected || connecting) closeSocket()
      if(selectedProfile.id === p.id) setSelectedProfile(remaining[0] || QUICK_PROFILE)
    }
    log(`Deleted profile “${p.name}”`)
    notify(`Deleted “${p.name}”`)
    closeSheet()
  }

  /* ---------------- misc actions ---------------- */

  const copyText = async (text:string, label:string)=>{
    try{
      if(navigator.clipboard?.writeText) await navigator.clipboard.writeText(text)
      else {
        const field = document.createElement('textarea')
        field.value = text
        field.readOnly = true
        field.style.cssText = 'position:fixed;left:-9999px;top:0'
        document.body.appendChild(field)
        let copied = false
        try{ field.select(); copied = document.execCommand('copy') }
        finally{ field.remove() }
        if(!copied) throw new Error('Copy failed')
      }
      notify(label)
    }catch{ notify('Clipboard is not available here') }
  }
  const openExternal = (url:string)=>{
    try{
      const target = new URL(url)
      if(target.protocol !== 'https:' && target.protocol !== 'http:') throw new Error('Invalid link')
      // With noopener browsers can return null even when the tab opened successfully.
      window.open(target.toString(), '_blank', 'noopener,noreferrer')
    }catch{ notify('Could not open this link') }
  }
  const enableNotifications = async ()=>{
    if(typeof Notification === 'undefined'){ notify('This device has no system notifications'); return }
    if(Notification.permission === 'denied'){ notify('Blocked — allow notifications for this site'); return }
    let p:NotificationPermission
    try{ p = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission() }
    catch{ notify('Could not request notification permission'); return }
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
    if(notifEnabled && notifPerm === 'granted'){ setNotifEnabled(false); notify('System notifications off'); log('System notifications disabled'); return }
    enableNotifications()
  }
  const giveFeedback = (value:'up'|'down')=>{
    const next = feedback === value ? null : value
    setFeedback(next)
    writeJSON('openpath:feedback', next)
    notify(next ? 'Thanks — feedback saved' : 'Feedback cleared')
  }
  const resetLocal = ()=>{
    if(!confirmReset){
      setConfirmReset(true)
      if(resetTimer.current) clearTimeout(resetTimer.current)
      resetTimer.current = setTimeout(()=>setConfirmReset(false), 4000)
      return
    }
    if(resetTimer.current) clearTimeout(resetTimer.current)
    closeSocket()
    hostsRequestRef.current++
    setHostsLoading(false)
    setHostsError(null)
    try{
      ['openpath:editable-profiles','openpath:mode','openpath:netshield','openpath:recents','openpath:feedback','openpath:notifications','openpath:serverUrl','openpath:user','openpath:selectedProfileId']
        .forEach(k=> localStorage.removeItem(k))
    }catch{}
    const defaults = DEFAULT_EDITABLE.map(p=>({ ...p }))
    setEditableProfiles(defaults)
    setSelectedProfile(defaults[3])
    setVpnMode('stealth')
    setRecents([])
    setFeedback(null)
    setNotifEnabled(true)
    setUser('demo')
    setPsk('demo-student-key-do-not-use-prod')
    const address = defaultServerUrl(location)
    setServerUrlRaw(address)
    setHosts(null)
    setDirectoryFor('')
    writeJSON('openpath:serverUrl', address)
    setFetchResult(null)
    setConfirmReset(false)
    log('Local profiles and settings reset; session disconnected')
    notify('Local data reset')
  }

  // Window controls only exist in the Electron shells; in a browser they are hidden
  const winCtl: { minimize:()=>void; maximize:()=>void; close:()=>void } | null =
    (typeof window !== 'undefined' && ((window as any).openpathWindow || (window as any).openpath?.window || (window as any).openpathLinux?.window)) || null

  const serverUrlValid = (()=>{ try{ parseServerUrl(serverUrlRaw); return true }catch{ return false } })()
  const commitServerUrl = (v:string)=>{
    // Persist only a complete valid value when the field is committed.
    try{
      parseServerUrl(v)
      writeJSON('openpath:serverUrl', v)
    }catch{}
  }

  const durationMs = startedAt ? Math.max(0, now - startedAt) : 0
  const locationText = myLocation.source === 'default' ? 'Unknown' : myLocation.city
  const displayServerUrl = activeServer?.url || targetRef.current?.url || serverUrlRaw
  const serverHost = (()=>{ try{ return new URL(displayServerUrl).host }catch{ return displayServerUrl } })()

  /* ---------------- chrome ---------------- */

  const TopChrome = () => (
    <div className="app-chrome">
      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
        <span className="app-brand">◈ OpenPath <small>UI preview</small></span>
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
    const exitCountry = activeServer?.country ? COUNTRY_COORDS[activeServer.country] : undefined
    const exit = exitCountry ? projectPoint(exitCountry.lat, exitCountry.lon) : null
    return (
      <div className="home-map" style={{ position:'relative', height:220, overflow:'hidden', background:'#08080c' }}>
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
        {highlighted && exit && exitCountry && (
          <>
            <div style={{ position:'absolute', left:`${exit.x}%`, top:`${exit.y}%`, width:28, height:28, background:'rgba(16,196,126,0.25)', borderRadius:999, display:'grid', placeItems:'center', transform:'translate(-50%,-50%)' }}>
              <div style={{ width:14, height:14, background:'#0ac47e', borderRadius:999, border:'3px solid #fff', boxShadow:'0 0 12px rgba(16,196,126,0.9)' }} />
              <div style={{ position:'absolute', inset:0, borderRadius:999, border:'1px solid rgba(16,196,126,0.5)', animation:'pulse 2s infinite' } as any} />
            </div>
            <div style={{ position:'absolute', left:`${exit.x}%`, top:`calc(${exit.y}% + 16px)`, transform:'translateX(-50%)', whiteSpace:'nowrap', fontSize:9, fontWeight:700, color:'#a7f3d0', background:'rgba(0,0,0,0.65)', border:'1px solid rgba(16,196,126,0.4)', borderRadius:999, padding:'1px 7px' }}>
              {exitCountry.name} (approx.)
            </div>
          </>
        )}
        {myLocation.source !== 'default' && (
          <>
        <div style={{ position:'absolute', left:`${you.x}%`, top:`${you.y}%`, width: highlighted ? 18 : 26, height: highlighted ? 18 : 26, background: highlighted ? 'rgba(148,163,184,0.25)' : 'rgba(59,130,246,0.28)', borderRadius:999, display:'grid', placeItems:'center', transform:'translate(-50%,-50%)', transition:'all 0.2s' }}>
          <div style={{ width: highlighted ? 8 : 12, height: highlighted ? 8 : 12, background: highlighted ? '#94a3b8' : '#3b82f6', borderRadius:999, border:`${highlighted?2:3}px solid #fff`, boxShadow: highlighted ? '0 0 8px rgba(148,163,184,0.8)' : '0 0 14px rgba(59,130,246,1)' }} />
          {!highlighted && <div style={{ position:'absolute', inset:0, borderRadius:999, border:'1px solid rgba(59,130,246,0.7)', animation:'pulse 2s infinite' } as any} />}
        </div>
        <div style={{ position:'absolute', left:`${you.x}%`, top:`calc(${you.y}% + ${highlighted?12:18}px)`, transform:'translateX(-50%)', whiteSpace:'nowrap', fontSize:9, fontWeight:700, color: highlighted ? '#cbd5e1' : '#bfdbfe', background:'rgba(0,0,0,0.65)', border:`1px solid ${highlighted?'#2a2a38':'rgba(59,130,246,0.5)'}`, borderRadius:999, padding:'1px 7px' }}>
          {highlighted ? 'You' : 'Your location'}
        </div>
          </>
        )}
        <div style={{ position:'absolute', inset:0, background:'linear-gradient(to top, #0a0a0f 0%, transparent 40%, transparent 70%, rgba(10,106,90,0.25) 100%)', pointerEvents:'none' }} />
      </div>
    )
  }

  /* ---------------- Home ---------------- */

  const HomeTab = () => (
    <div className="home-layout">
      <div className="home-summary" style={{
        background: connected ? 'linear-gradient(180deg, #0e6b52 0%, #0a3a2e 60%, #0a0a0f 100%)' : 'linear-gradient(180deg, #1a1a24 0%, #0a0a0f 100%)',
        padding:'14px 16px 10px', textAlign:'center', borderBottom:'1px solid #1a1a24',
      }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:8, color: connected ? '#5eefc1' : connecting ? '#fbbf24' : '#f87171', fontWeight:800, fontSize:15 }}>
          <span style={{ width:18, height:18, borderRadius:999, background: connected ? '#0ac47e' : connecting ? '#f59e0b' : '#ef4444', display:'grid', placeItems:'center', fontSize:11, color:'#fff' }}>{connected ? '🔗' : connecting ? '…' : '🔓'}</span>
          {connected ? 'Session connected' : connecting ? 'Connecting…' : deviceBridge ? 'Web session disconnected' : 'Not connected'}
        </div>

        {!connected && !connecting && (
          <div style={{ marginTop:8, color:'#e5e7eb', fontSize:12, lineHeight:1.6 }}>
            <div style={{ color:'#fbbf24', fontWeight:700 }}>{deviceBridge ? 'Web session is separate from the device VPN below' : '⚠️ Device traffic is not protected'}</div>
            <div style={{ color:'#9ca3af', fontSize:11 }}>IP reported by server: <span style={{ color:'#fff', fontFamily:'monospace', fontWeight:700 }}>{clientIpLoading ? '…' : clientIp || '—'}</span></div>
            <div style={{ color:'#9ca3af', fontSize:11, marginTop:2 }}>Your location: <span style={{ color:'#bfdbfe', fontWeight:700 }}>{locationText}</span></div>
            <div style={{ color:'#9ca3af', fontSize:11, marginTop:2 }}>The web app does not route other browser or device traffic.</div>
            <button onClick={()=>connect(undefined, QUICK_PROFILE, vpnMode)} style={{ marginTop:10, background:'#6d4aff', color:'#fff', border:0, padding:'10px 28px', borderRadius:999, fontWeight:800, cursor:'pointer', fontSize:13 }}>Quick Connect</button>
          </div>
        )}
        {connecting && (
          <div style={{ marginTop:10, color:'#fbbf24', fontSize:12 }}>Opening session to {serverHost}… <button onClick={disconnect} style={{ marginLeft:6, background:'transparent', border:'1px solid #6b7280', borderRadius:8, padding:'4px 8px', color:'#fff', cursor:'pointer' }}>Cancel connection</button></div>
        )}
        {connected && (
          <div style={{ color:'#a7f3d0', fontSize:11, marginTop:4 }}>{activeMode === 'fast' ? 'Turbo' : 'Stealth'} session • {activeServer?.url.startsWith('wss:') ? 'TLS' : 'Unencrypted WS'} • RTT {rtt} ms<br/><span style={{ color:'#fbbf24' }}>{deviceBridge ? 'The WebSocket session is separate from the device VPN below.' : 'Device and other browser traffic are not protected.'}</span></div>
        )}

        {deviceBridge ? <div style={{ marginTop:14 }}><DeviceVpnPanel bridge={deviceBridge} /></div> : (
        <button
          onClick={()=>setShieldOpen(true)}
          aria-label="Learn about NetShield availability"
          style={{ width:'100%', marginTop:14, background:'#1c1b26', border:'1px solid #2a2a38', borderRadius:12, padding:'10px 12px', display:'flex', alignItems:'center', justifyContent:'space-between', cursor:'pointer', color:'inherit', textAlign:'left' }}
        >
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <span style={{ width:24, height:24, borderRadius:6, background:'linear-gradient(135deg, #0ac47e, #06b6d4)', display:'grid', placeItems:'center', fontSize:12 }}>🛡️</span>
            <div>
              <div style={{ color:'#fff', fontWeight:700, fontSize:12 }}>NetShield</div>
              <div style={{ color:'#9ca3af', fontSize:10 }}>Not available in the web client</div>
            </div>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:6, color:'#9ca3af', fontSize:12 }}>
            <span style={{ color:'#fff', fontSize:12, fontWeight:700 }}>Learn more</span>
            <span>›</span>
          </div>
        </button>
        )}

        <div style={{ marginTop:8, background:'#13131a', borderRadius:10, padding:'8px 10px', display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:6, border:'1px solid #1f1f2a' }}>
          <div style={{ textAlign:'center' }}><div style={{ color:'#fff', fontWeight:800, fontSize:13 }}>{fmtBytes(rx)}</div><div style={{ color:'#8b8da3', fontSize:9 }}>Downloaded</div></div>
          <div style={{ textAlign:'center', borderLeft:'1px solid #2a2a38', borderRight:'1px solid #2a2a38' }}><div style={{ color:'#fff', fontWeight:800, fontSize:13 }}>{fmtBytes(tx)}</div><div style={{ color:'#8b8da3', fontSize:9 }}>Uploaded</div></div>
          <div style={{ textAlign:'center' }}><div style={{ color:'#fff', fontWeight:800, fontSize:13 }}>{fmtDuration(durationMs)}</div><div style={{ color:'#8b8da3', fontSize:9 }}>Session</div></div>
        </div>
      </div>

      {WorldMap({ highlighted: connected })}

      <div className="home-feedback" style={{ background:'#0a0a0f', padding:'10px 16px', display:'flex', alignItems:'center', justifyContent:'space-between', borderTop:'1px solid #1a1a24', borderBottom:'1px solid #1a1a24' }}>
        <span style={{ color:'#e5e7eb', fontSize:12 }}>{feedback ? 'Thanks for the feedback' : 'How is your connection?'}</span>
        <div style={{ display:'flex', gap:12, alignItems:'center' }}>
          <button onClick={()=>giveFeedback('down')} aria-label="Bad connection" aria-pressed={feedback==='down'}
            style={{ background: feedback==='down' ? '#2a2340' : 'transparent', border: feedback==='down' ? '1px solid #7c4dff' : '1px solid transparent', borderRadius:8, cursor:'pointer', fontSize:14, color:'#6b7280', padding:'2px 6px' }}>👎</button>
          <span style={{ width:1, height:14, background:'#2a2a38' }} />
          <button onClick={()=>giveFeedback('up')} aria-label="Good connection" aria-pressed={feedback==='up'}
            style={{ background: feedback==='up' ? '#2a2340' : 'transparent', border: feedback==='up' ? '1px solid #7c4dff' : '1px solid transparent', borderRadius:8, cursor:'pointer', fontSize:14, color:'#6b7280', padding:'2px 6px' }}>👍</button>
        </div>
      </div>

      <div className="home-details" style={{ padding:12, background:'#000', paddingBottom:80 }}>
        {connected ? (
          <div style={{ background:'#1c1b26', border:'1px solid #2a2a38', borderRadius:16, padding:14 }}>
            <button
              onClick={()=>openSheet(selectedProfile)}
              aria-label={`Open ${selectedProfile.name} details`}
              style={{ display:'flex', alignItems:'center', gap:10, width:'100%', background:'transparent', border:0, cursor:'pointer', color:'inherit', textAlign:'left', padding:0 }}
            >
              <div style={{ width:36, height:36, borderRadius:8, background:selectedProfile.color || '#2a2a38', display:'grid', placeItems:'center', fontSize:14, position:'relative' }}>
                {selectedProfile.icon}
                <span style={{ position:'absolute', bottom:-2, right:-2, background:'#fff', borderRadius:999, width:14, height:14, display:'grid', placeItems:'center', fontSize:9, border:'1px solid #ddd' }}>{selectedProfile.flag || '🌐'}</span>
              </div>
              <div style={{ flex:1 }}>
                <div style={{ color:'#fff', fontWeight:700, fontSize:14 }}>{selectedProfile.name}</div>
                <div style={{ color:'#9ca3af', fontSize:12 }}>{activeServer?.name || 'Server'} • {activeServer?.country ? countryName(activeServer.country) : 'Location unknown'} • {activeMode === 'fast' ? 'Turbo' : 'Stealth'}</div>
              </div>
              <span style={{ color:'#6b7280', fontSize:16 }}>⌃</span>
            </button>
            <button onClick={disconnect} style={{ width:'100%', marginTop:12, background:'#2a2a38', color:'#e5e7eb', border:'1px solid #3a3a4a', padding:'12px', borderRadius:10, fontWeight:700, cursor:'pointer' }}>Disconnect</button>
            <button onClick={()=>setTab('countries')} style={{ width:'100%', marginTop:8, background:'transparent', color:'#e5e7eb', border:'1px solid #2a2a38', padding:'11px', borderRadius:10, fontWeight:600, cursor:'pointer' }}>Change server</button>
            <div style={{ marginTop:10, display:'flex', justifyContent:'center', gap:8 }}>
              <span style={{ width:8, height:8, borderRadius:999, background:'#0ac47e', boxShadow:'0 0 8px #0ac47e' }} />
              <span style={{ color:'#9ca3af', fontSize:11 }}>Session traffic • ↓ {fmtBytes(rx)} ↑ {fmtBytes(tx)}</span>
            </div>
          </div>
        ) : (
          <div style={{ background:'#1c1b26', border:'1px solid #2a2a38', borderRadius:16, padding:14, textAlign:'center' }}>
            <div style={{ color:'#f87171', fontWeight:700, fontSize:13, display:'flex', alignItems:'center', justifyContent:'center', gap:6 }}>🔓 Not connected</div>
            <div style={{ color:'#9ca3af', fontSize:12, marginTop:6, lineHeight:1.5 }}>
              IP reported by server: <span style={{ color:'#fff', fontFamily:'monospace' }}>{clientIpLoading ? '…' : clientIp || 'unavailable'}</span><br/>
              Your location <span style={{ color:'#bfdbfe', fontWeight:700 }}>{locationText}</span><br/>
              Connect to send individual requests through a server. This does not protect other traffic.
            </div>
            <div style={{ marginTop:10, display:'flex', gap:8 }}>
              <button onClick={()=>connect(undefined, QUICK_PROFILE, vpnMode)} disabled={connecting} style={{ flex:1, background: connecting ? '#4a3a9a' : '#6d4aff', color:'#fff', border:0, padding:'12px', borderRadius:10, fontWeight:800, cursor: connecting ? 'default' : 'pointer' }}>{connecting ? 'Connecting…' : 'Quick Connect'}</button>
              <button onClick={()=>setTab('countries')} style={{ flex:1, background:'transparent', color:'#e5e7eb', border:'1px solid #3a3a4a', padding:'12px', borderRadius:10, fontWeight:600, cursor:'pointer' }}>Change server</button>
            </div>
            <div style={{ marginTop:10, fontSize:11, color:'#6b7280' }}>Default: <span style={{ color:'#a78bfa' }}>configured server • {vpnMode === 'fast' ? 'Turbo' : 'Stealth'}</span></div>
          </div>
        )}

        {connected && (
          <div style={{ marginTop:12, background:'#12121a', border:'1px solid #2a2a38', borderRadius:12, padding:12 }}>
            <label htmlFor="fetch-url" style={{ color:'#e5e7eb', fontSize:12, fontWeight:700 }}>Fetch through this server</label>
            <div style={{ color:'#9ca3af', fontSize:11, marginTop:4 }}>Sends one GET request through the connected session, not your other traffic.</div>
            <div style={{ display:'flex', gap:8, marginTop:8 }}>
              <input id="fetch-url" value={fetchUrl} onChange={e=>setFetchUrl(e.target.value)} placeholder="https://example.com/" style={{ minWidth:0, flex:1, background:'#1a1a24', border:'1px solid #2a2a38', borderRadius:8, color:'#fff', padding:'9px', fontSize:11 }} />
              <button onClick={fetchViaServer} disabled={fetching} style={{ background:'#6d4aff', border:0, borderRadius:8, padding:'9px 12px', color:'#fff', cursor:fetching?'default':'pointer', fontWeight:700 }}>{fetching ? 'Fetching…' : 'Fetch'}</button>
            </div>
            {fetchResult && <div role="region" aria-label="Server fetch result" style={{ marginTop:8, color:'#e5e7eb', fontSize:11 }}>
              <strong>HTTP {fetchResult.status}</strong>{fetchResult.truncated && <span> • response truncated</span>}
              <pre style={{ maxHeight:150, overflow:'auto', whiteSpace:'pre-wrap', wordBreak:'break-word', color:'#9ca3af' }}>{fetchResult.body}</pre>
            </div>}
          </div>
        )}

        <div style={{ marginTop:12, background:'#0f0f14', border:'1px solid #1f1f2a', borderRadius:12, padding:10, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div style={{ fontSize:11, color:'#9ca3af' }}>{vpnMode === 'fast' ? '⚡ Turbo' : '🛡️ Stealth'} • {vpnMode === 'fast' ? 'Fast WebSocket endpoint' : 'Stealth WebSocket endpoint'}</div>
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
              const p = editableProfiles.find(x=>x.id===r.profileId) || { ...QUICK_PROFILE, id:r.profileId, name:r.name }
              let target = r.serverUrl ? targets.find(t=>t.url === r.serverUrl) : undefined
              if(r.serverUrl && !target){
                target = { id:`recent-${r.serverUrl}`, name:r.serverName || r.city || 'Recent server', url:r.serverUrl, country:'', region:r.city, flag:r.flag, isMain:false }
              }
              void connect(target, p, r.mode)
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
            {releases?.length ? `${releases.length} releases • latest ${releases[0]?.tag_name || releases[0]?.name}` : releases ? 'No releases published yet' : 'Native installers for Windows, macOS, Linux, Android & iOS'}
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

  const CountriesTab = () => {
    const configuredTarget:ServerTarget = targets.find(t=>t.isMain) || {
      id:'main', name:'Configured server', url:serverUrlRaw, country:'', region:'', flag:'🌐', isMain:true,
    }
    const listedTargets = targets.length ? targets : [configuredTarget]
    const profileForServer = (target:ServerTarget):EditableProfile => ({
      ...QUICK_PROFILE, id:`server-${target.id}`, name:target.name,
      countryCode:target.country || 'AUTO', countryName:target.country ? countryName(target.country) : 'Any available server',
      flag:target.flag, city:target.region || 'Fastest', subtitle:target.region || (target.country ? countryName(target.country) : 'Location unknown'),
      protocol:'Smart (auto)',
    })
    return (
      <div style={{ background:'#000', minHeight:'100%', paddingBottom:80 }}>
        <div style={{ padding:'16px 16px 10px', position:'sticky', top:0, background:'#000', zIndex:2 }}>
          <div style={{ color:'#fff', fontWeight:800, fontSize:18 }}>Countries &amp; servers</div>
          <div style={{ color:'#9ca3af', fontSize:11, marginTop:4 }}>Choose a real server from the configured directory. Country and region are supplied by its operator.</div>
          <label htmlFor="server-address" style={{ display:'block', color:'#9ca3af', fontSize:11, marginTop:10 }}>Directory / default server address</label>
          <div style={{ marginTop:5, display:'flex', gap:6 }}>
            <input id="server-address" value={serverUrlRaw} onChange={e=>setServerUrlRaw(e.target.value)} onBlur={e=>commitServerUrl(e.target.value)} onKeyDown={e=>{ if(e.key === 'Enter'){ commitServerUrl(serverUrlRaw); void fetchHosts(true) } }} aria-label="Server address" spellCheck={false}
              style={{ minWidth:0, flex:1, background:'#1a1a24', border:`1px solid ${serverUrlValid ? '#2a2a38' : '#ef4444'}`, color:'#e5e7eb', padding:'8px 10px', borderRadius:8, fontSize:11, fontFamily:'monospace' }} />
            <button onClick={()=>fetchHosts(true)} disabled={hostsLoading} aria-label="Refresh server list" title="Refresh server list"
              style={{ background:'#1a1a24', border:'1px solid #2a2a38', color:'#e5e7eb', padding:'0 12px', borderRadius:8, cursor:'pointer', fontSize:12 }}>{hostsLoading ? '…' : '↻'}</button>
          </div>
          {!serverUrlValid && <div style={{ color:'#f87171', fontSize:10, marginTop:6 }}>Use a ws:// or wss:// address without embedded credentials.</div>}
          {hostsError && <div role="alert" style={{ color:'#fbbf24', fontSize:11, marginTop:6 }}>Directory unavailable: {hostsError}. You can still try the configured server.</div>}
          {!hostsError && !targets.length && !hostsLoading && <div style={{ color:'#9ca3af', fontSize:11, marginTop:6 }}>Refresh to load servers for this address.</div>}
        </div>
        <div style={{ padding:'0 12px', display:'grid', gap:8 }}>
          {listedTargets.map(target=>{
            const isCurrent = connected && activeServer?.url === target.url
            return (
              <button key={target.id} onClick={()=>{ if(isCurrent) disconnect(); else void connect(target, profileForServer(target)) }}
                aria-label={`${isCurrent ? 'Disconnect from' : 'Connect to'} ${target.name}`}
                style={{ textAlign:'left', width:'100%', background:isCurrent?'#12211c':'#12121a', border:`1px solid ${isCurrent?'#0ac47e':'#1f1f2a'}`, borderRadius:12, padding:'12px 14px', display:'flex', alignItems:'center', justifyContent:'space-between', cursor:'pointer' }}>
                <div style={{ display:'flex', gap:10, alignItems:'center', minWidth:0 }}>
                  <span style={{ fontSize:22 }}>{target.flag}</span>
                  <div style={{ minWidth:0 }}>
                    <div style={{ color:'#fff', fontWeight:700, fontSize:13 }}>{target.name}</div>
                    <div style={{ color:'#9ca3af', fontSize:11 }}>{target.country ? countryName(target.country) : 'Location not provided'}{target.region ? ` • ${target.region}` : ''}{target.isMain ? ' • Default' : ''}</div>
                    <div style={{ color:'#6b7280', fontSize:10, overflow:'hidden', textOverflow:'ellipsis' }}>{target.url}</div>
                  </div>
                </div>
                <span style={{ color:isCurrent?'#0ac47e':'#a78bfa', fontSize:11, fontWeight:700, border:`1px solid ${isCurrent?'#0ac47e':'#6d4aff'}`, padding:'4px 8px', borderRadius:999, flexShrink:0 }}>{isCurrent ? 'Disconnect' : 'Connect'}</span>
              </button>
            )
          })}
          {targets.length > 0 && <div style={{ color:'#9ca3af', fontSize:11, padding:'6px 2px' }}>{targets.length} available {targets.length === 1 ? 'server' : 'servers'} • refresh to update</div>}
        </div>
      </div>
    )
  }

  /* ---------------- Profile sheet ---------------- */

  const ProfileSheet = () => {
    if(!sheetProfile) return null
    const p = sheetProfile
    const isThisConnected = connected && selectedProfile.id === p.id
    const isSavedProfile = editableProfiles.some(profile=>profile.id === p.id)
    const detailRows: { label:string; value:string; step:1|2|3 }[] = [
      { label:'Country', value:`${p.flag || '🌐'} ${countryName(p.countryCode)}`, step:2 },
      { label:'Region', value:p.city === 'Fastest' ? 'Any available region' : p.city, step:2 },
      { label:'Transport', value:p.protocol, step:3 },
    ]
    return (
      <div style={{ position:'fixed', inset:0, zIndex:30, display:'flex', flexDirection:'column', justifyContent:'flex-end' }} onClick={closeSheet}>
        <div style={{ position:'absolute', inset:0, background:'rgba(0,0,0,0.6)' }} />
        <div onClick={e=>e.stopPropagation()} style={{ position:'relative', background:'#0f0f14', borderTopLeftRadius:16, borderTopRightRadius:16, borderTop:'1px solid #2a2a38', maxHeight:'78vh', overflow:'auto', animation:'slideUp 0.2s ease' }}>
          <div style={{ display:'flex', justifyContent:'center', padding:'10px 0 6px' }}><div style={{ width:36, height:4, borderRadius:999, background:'#3a3a4a' }} /></div>
          <div style={{ padding:'8px 16px 12px', display:'flex', alignItems:'center', gap:12, borderBottom:'1px solid #1a1a24' }}>
            <div style={{ width:36, height:36, borderRadius:8, background:p.color || '#1e1b2e', border:'1px solid #2a2a38', display:'grid', placeItems:'center', fontSize:16 }}>{p.icon}</div>
            <div style={{ flex:1 }}>
              <div style={{ color:'#fff', fontWeight:700, fontSize:13 }}>{p.name}</div>
              <div style={{ color:'#9ca3af', fontSize:11 }}>{countryName(p.countryCode)}{p.city && p.city !== 'Fastest' ? ` • ${p.city}` : ''}</div>
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
              <button onClick={()=>editAt(p,1)} style={{ textAlign:'left', background:'transparent', border:0, padding:'14px 16px', color:'#e5e7eb', fontSize:13, cursor:'pointer', display:'flex', alignItems:'center', gap:12, borderBottom:'1px solid #2a2a38' }}><span>✎</span> {isSavedProfile ? 'Edit' : 'Save as profile'}</button>
              {isSavedProfile && <><button onClick={()=>duplicateProfile(p)} style={{ textAlign:'left', background:'transparent', border:0, padding:'14px 16px', color:'#e5e7eb', fontSize:13, cursor:'pointer', display:'flex', alignItems:'center', gap:12, borderBottom:'1px solid #2a2a38' }}><span>⧉</span> Duplicate</button>
              <button onClick={()=>deleteProfile(p)} style={{ textAlign:'left', background:'transparent', border:0, padding:'14px 16px', color: confirmDelete ? '#fecaca' : '#f87171', fontSize:13, cursor:'pointer', display:'flex', alignItems:'center', gap:12 }}>
                <span>🗑</span> {confirmDelete ? 'Tap again to delete' : 'Delete'}
              </button></>}
            </div>
            <button onClick={()=>{ if(isThisConnected) disconnect(); else void connect(undefined, p); closeSheet(); setTab('home') }}
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
    const availableCountries = [...new Set(targets.map(t=>t.country).filter(Boolean))].sort()
    if(e.countryCode !== 'AUTO' && !availableCountries.includes(e.countryCode)) availableCountries.push(e.countryCode)
    const countryOptions:MenuOption[] = [{ value:'AUTO', label:'Any available server', icon:'🌐' }, ...availableCountries.map(code=>({
      value:code, label:`${countryName(code)}${targets.some(t=>t.country === code) ? '' : ' (unavailable)'}`, icon:countryFlag(code),
    }))]
    const regions = [...new Set(targets.filter(t=>e.countryCode === 'AUTO' || t.country === e.countryCode).map(t=>t.region).filter(Boolean))].sort()
    if(e.city !== 'Fastest' && !regions.includes(e.city)) regions.push(e.city)
    const cityOptions:MenuOption[] = [{ value:'Fastest', label:'Any available region', icon:'🌐' }, ...regions.map(region=>({
      value:region, label:`${region}${targets.some(t=>(e.countryCode === 'AUTO' || t.country === e.countryCode) && t.region === region) ? '' : ' (unavailable)'}`, icon:'📍',
    }))]
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
              <div style={{ color:'#fff', fontWeight:700, fontSize:15, marginBottom:8 }}>Select a server location</div>
              <div style={{ color:'#9ca3af', fontSize:11, marginBottom:18 }}>Locations come from the current server directory. A location must have an online server when you connect.</div>
              <div style={{ display:'grid', gap:18 }}>
                <Picker label="Country" value={`${countryFlag(e.countryCode)} ${countryName(e.countryCode)}`} selectedValue={e.countryCode}
                  options={countryOptions}
                  onChange={v=>{ set({ countryCode:v, countryName:countryName(v), flag:countryFlag(v), city:'Fastest' }); setOpenMenu(null) }}
                  open={openMenu === 'country'} onToggle={()=>setOpenMenu(openMenu === 'country' ? null : 'country')} />
                <Picker label="Region" value={e.city === 'Fastest' ? 'Any available region' : e.city} selectedValue={e.city}
                  options={cityOptions} onChange={v=>{ set({ city:v }); setOpenMenu(null) }}
                  open={openMenu === 'city'} onToggle={()=>setOpenMenu(openMenu === 'city' ? null : 'city')} />
              </div>
            </div>
          )}

          {editStep === 3 && (
            <div style={{ maxWidth:520, margin:'0 auto' }} onClick={ev=>ev.stopPropagation()}>
              <div style={{ color:'#fff', fontWeight:700, fontSize:15 }}>Configure the connection</div>
              <div style={{ color:'#9ca3af', fontSize:11, marginTop:4, marginBottom:16 }}>This transport is used when you connect from the profile. Smart follows the app's current selection.</div>
              {settingRow('protocol','Transport', e.protocol, PROTOCOL_OPTIONS.map(o=>({ value:o, label:o })), v=>set({ protocol:v as EditableProfile['protocol'] }))}
              {!PROTOCOL_OPTIONS.includes(e.protocol) && <div role="alert" style={{ color:'#fbbf24', fontSize:11, marginTop:8 }}>This legacy transport is unavailable here. Choose a supported transport before connecting.</div>}
              <div style={{ color:'#9ca3af', fontSize:11, lineHeight:1.5, marginTop:18 }}>NetShield, custom DNS, NAT, LAN controls and automatic reconnect are not available in this web client and are not applied to the session.</div>
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
              <div style={{ width:36, height:36, borderRadius:8, background:p.color || '#1e1b2e', display:'grid', placeItems:'center', fontSize:16, position:'relative', border:'1px solid #2a2a38' }}>
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
        <div style={{ color:'#4b5563', fontSize:11, textAlign:'center', marginTop:8 }}>Profiles are saved on this device. They select a directory location and transport for a web session.</div>
      </div>
    </div>
  )

  /* ---------------- Settings ---------------- */

  const SettingsTab = () => {
    const notifSub = notifPerm === 'granted'
      ? (notifEnabled ? 'On — session alerts go to your system notification centre' : 'Off — tap to enable system notifications')
      : notifPerm === 'denied'
        ? 'Blocked by the system — allow notifications for this site, then tap again'
        : 'Off — tap to ask the system for permission'
    return (
      <div style={{ background:'#000', minHeight:'100%', paddingBottom:80 }}>
        <div style={{ padding:'16px 16px 0' }}>
          <div style={{ color:'#fff', fontWeight:800, fontSize:18 }}>Settings</div>
          <div style={{ color:'#8b8da3', fontSize:11, marginTop:4 }}>Configure the web session and local preferences.</div>
        </div>
        <div style={{ padding:'0 16px 16px' }}>

          <Section title="Connection">
            <div style={{ padding:'13px 14px' }}>
              <div style={{ color:'#e5e7eb', fontSize:13, fontWeight:600 }}>Protocol</div>
              <div style={{ color:'#8b8da3', fontSize:11, marginTop:2 }}>
                {vpnMode === 'stealth' ? 'Stealth — the /ops WebSocket endpoint' : 'Turbo — the /fast WebSocket endpoint'}; transport security depends on using wss://.
              </div>
              <div style={{ marginTop:10, display:'flex', gap:6, background:'#0a0a0f', border:'1px solid #2a2a38', borderRadius:999, padding:3 }}>
                <button onClick={()=>chooseMode('stealth')} aria-pressed={vpnMode==='stealth'} style={{ flex:1, padding:'8px 10px', borderRadius:999, border:0, fontSize:12, fontWeight:700, cursor:'pointer', background: vpnMode === 'stealth' ? '#6d4aff' : 'transparent', color: vpnMode === 'stealth' ? '#fff' : '#9ca3af' }}>Stealth</button>
                <button onClick={()=>chooseMode('fast')} aria-pressed={vpnMode==='fast'} style={{ flex:1, padding:'8px 10px', borderRadius:999, border:0, fontSize:12, fontWeight:700, cursor:'pointer', background: vpnMode === 'fast' ? '#6d4aff' : 'transparent', color: vpnMode === 'fast' ? '#fff' : '#9ca3af' }}>Turbo</button>
              </div>
              {connected && <div style={{ color:'#0ac47e', fontSize:10, marginTop:6 }}>Switching transport reconnects this session automatically.</div>}
            </div>
            <div style={{ padding:'0 14px 13px' }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8 }}>
                <button onClick={()=>setTab('countries')} aria-label="Open server list" style={{ minWidth:0, textAlign:'left', background:'transparent', border:0, color:'inherit', cursor:'pointer', padding:0 }}>
                  <div style={{ color:'#e5e7eb', fontSize:12, fontWeight:600 }}>Server</div>
                  <div style={{ color:'#8b8da3', fontSize:11, fontFamily:'monospace', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{serverHost}</div>
                </button>
                <button onClick={()=>fetchHosts(true)} style={{ background:'#1a1a24', border:'1px solid #2a2a38', color:'#e5e7eb', padding:'6px 12px', borderRadius:8, cursor:'pointer', fontSize:11, flexShrink:0 }}>↻ Refresh</button>
              </div>
              <div style={{ color:'#8b8da3', fontSize:11, marginTop:6 }}>{targets.length ? `${targets.length} servers in the current directory` : 'Server list not loaded for this address'}</div>
            </div>
            <div style={{ padding:'0 14px 14px', display:'grid', gap:8 }}>
              <label style={{ color:'#e5e7eb', fontSize:12, fontWeight:600 }}>Username
                <input aria-label="Username" value={user} onChange={e=>setUser(e.target.value)} autoComplete="username" style={{ display:'block', width:'100%', marginTop:4, background:'#1a1a24', border:'1px solid #2a2a38', borderRadius:8, color:'#fff', padding:'9px' }} />
              </label>
              <label style={{ color:'#e5e7eb', fontSize:12, fontWeight:600 }}>Pre-shared key (PSK)
                <input aria-label="Pre-shared key (PSK)" type="password" value={psk} onChange={e=>setPsk(e.target.value)} autoComplete="off" style={{ display:'block', width:'100%', marginTop:4, background:'#1a1a24', border:'1px solid #2a2a38', borderRadius:8, color:'#fff', padding:'9px' }} />
              </label>
              <div style={{ color:'#8b8da3', fontSize:10 }}>The PSK stays in this tab's memory and is not saved. The default key is for demos only.</div>
            </div>
          </Section>

          {deviceBridge && <Section title="Device VPN"><div style={{padding:10}}><DeviceVpnPanel bridge={deviceBridge} /></div></Section>}

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
            <SettingRow icon="🐞" title="Report an issue" sub="Opens a new GitHub issue" onClick={()=>openExternal('https://github.com/mob5824m-wq/OpenPath-VPN/issues/new')} last />
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
            <SettingRow icon="↺" title={confirmReset ? 'Tap again to confirm reset' : 'Reset local data'} sub="Resets web profiles, recents, server address and local settings; the native WireGuard profile is separate"
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
      const assets = (rel.assets || []).filter(a=> filter.match(a.name))
      return { rel, assets }
    }).filter(x=> filter.id === 'all' || x.assets.length > 0)

    return (
      <div style={{ background:'#000', minHeight:'100%', paddingBottom:80 }}>
        <div style={{ padding:'16px 16px 8px' }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <button onClick={goBack} style={{ background:'transparent', border:'1px solid #2a2a38', color:'#e5e7eb', padding:'6px 10px', borderRadius:999, cursor:'pointer' }}>‹ Back</button>
            <div style={{ color:'#fff', fontWeight:800, fontSize:18 }}>Releases</div>
          </div>
          <div style={{ color:'#9ca3af', fontSize:11, marginTop:8 }}>Published GitHub releases and attached files. If the release service is offline, the browser contacts GitHub directly.</div>
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
          {releasesWarning && <div role="status" style={{ color:'#fbbf24', fontSize:11, padding:12, border:'1px solid #2a2a38', borderRadius:10 }}>Showing cached releases: {releasesWarning}</div>}
          {releasesSource && !releasesWarning && <div style={{ color:'#6b7280', fontSize:10 }}>Source: {releasesSource === 'server' ? 'server cache / GitHub' : 'GitHub directly'}</div>}
          {releasesError && <div role="alert" style={{ color:'#fbbf24', fontSize:11, padding:12, border:'1px solid #2a2a38', borderRadius:10 }}>Could not load releases: {releasesError}. Use Refresh to try again. <button onClick={()=>openExternal('https://github.com/mob5824m-wq/OpenPath-VPN/releases')} style={{ background:'transparent', border:0, color:'#a78bfa', cursor:'pointer' }}>Open GitHub releases ↗</button></div>}
          {releases && releases.length === 0 && (
            <div style={{ background:'#1c1b26', border:'1px solid #2a2a38', borderRadius:12, padding:14, color:'#9ca3af', fontSize:11, textAlign:'center' }}>
              No releases have been published yet.
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
              <div style={{ color:'#9ca3af', fontSize:11, marginTop:6, whiteSpace:'pre-wrap', lineHeight:1.5 }}>{rel.body ? rel.body.slice(0, 320) : 'No release notes provided.'}</div>
              <div style={{ marginTop:8, display:'flex', gap:6, flexWrap:'wrap' }}>
                {assets.map(a=>(
                  <a key={a.id} href={a.browser_download_url} target="_blank" rel="noreferrer"
                    style={{ background:'#1a1a24', border:'1px solid #2a2a38', color:'#a78bfa', padding:'4px 8px', borderRadius:999, fontSize:10, textDecoration:'none' }}>{a.name} ⬇</a>
                ))}
                {assets.length === 0 && <span style={{ color:'#6b7280', fontSize:10 }}>{filter.id === 'all' ? 'No assets attached to this release' : `No ${filter.label} asset here`}</span>}
              </div>
              <button onClick={()=>openExternal(rel.html_url)} style={{ marginTop:8, background:'transparent', border:'1px solid #2a2a38', color:'#9ca3af', padding:'4px 10px', borderRadius:999, fontSize:10, cursor:'pointer' }}>Open on GitHub ↗</button>
            </div>
          ))}
          {!releases && !releasesLoading && !releasesError && (
            <div style={{ background:'#12121a', border:'1px solid #1f1f2a', borderRadius:12, padding:14 }}>
              <div style={{ color:'#e5e7eb', fontWeight:700, fontSize:12 }}>Releases for apps and profiles</div>
              <div style={{ color:'#9ca3af', fontSize:11, marginTop:6 }}>Load published releases and their attached installer assets from GitHub.</div>
              <button onClick={()=>fetchReleases(true)} style={{ marginTop:10, background:'#6d4aff', color:'#fff', border:0, padding:'10px 14px', borderRadius:8, fontWeight:700, cursor:'pointer', fontSize:12 }}>Load GitHub releases</button>
            </div>
          )}
          <div style={{ background:'#0f0f14', border:'1px solid #1f1f2a', borderRadius:12, padding:12 }}>
            <div style={{ color:'#e5e7eb', fontWeight:700, fontSize:12 }}>Local profiles</div>
            <div style={{ color:'#9ca3af', fontSize:11, marginTop:4 }}>Tap a locally saved profile to edit it. These profiles are not included in GitHub releases.</div>
            <div style={{ marginTop:8, display:'grid', gap:6 }}>
              {editableProfiles.map(p=>(
                <button key={p.id} onClick={()=>openSheet(p)} style={{ display:'flex', alignItems:'center', gap:8, background:'#1a1a24', border:'1px solid #2a2a38', borderRadius:8, padding:'8px 10px', cursor:'pointer', color:'inherit', textAlign:'left' }}>
                  <span style={{ color:'#a78bfa' }}>{p.icon}</span>
                  <span style={{ color:'#e5e7eb', fontSize:12, fontWeight:600 }}>{p.name}</span>
                  <span style={{ color:'#9ca3af', fontSize:10, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>• {p.countryName} • {p.city} • {p.protocol}</span>

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
    <nav className="app-nav" aria-label="Main navigation">
      {[
        { id:'home', label:'Home', icon:'⌂' },
        { id:'countries', label:'Countries', icon:'◍' },
        { id:'profiles', label:'Profiles', icon:'▭' },
        { id:'settings', label:'Settings', icon:'⚙' },
      ].map(it=>{
        const active = tab === it.id
        return (
          <button key={it.id} onClick={()=>setTab(it.id as Tab)} aria-label={it.label} aria-current={active ? 'page' : undefined}
            className="app-nav-item">
            <span className="app-nav-icon" aria-hidden="true">{it.icon}</span>
            <span className="app-nav-label">{it.label}</span>
          </button>
        )
      })}
    </nav>
  )

  /* ---------------- Root render ---------------- */

  return (
    <div className="app-shell">
      <style>{`@keyframes pulse{0%{transform:scale(0.8);opacity:0.8}100%{transform:scale(1.6);opacity:0}} @keyframes slideUp{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}`}</style>
      {TopChrome()}
      <main className="app-content">
        {tab === 'home' && HomeTab()}
        {tab === 'countries' && CountriesTab()}
        {tab === 'profiles' && ProfilesTab()}
        {tab === 'settings' && SettingsTab()}
        {tab === 'releases' && ReleasesTab()}
      </main>
      {BottomNav()}
      {sheetProfile && ProfileSheet()}
      {editing && EditWizard()}

      {/* The web client cannot change device DNS or filter other traffic. */}
      <Sheet open={shieldOpen} onClose={()=>setShieldOpen(false)} title="NetShield availability">
        <div style={{ color:'#e5e7eb', fontSize:12, lineHeight:1.6 }}>A browser session cannot change device DNS. In the desktop app, connect a WireGuard device VPN and choose DNS filtering for malware, ads and trackers.</div>
        <button onClick={()=>{ setShieldOpen(false); setReleasePlatform('all'); setTab('releases'); fetchReleases() }} style={{ marginTop:14, width:'100%', background:'#1a1a24', color:'#e5e7eb', border:'1px solid #3a3a4a', padding:'12px', borderRadius:10, fontWeight:700, cursor:'pointer' }}>Find desktop releases</button>
        <button onClick={()=>setShieldOpen(false)} style={{ marginTop:8, width:'100%', background:'#6d4aff', color:'#fff', border:0, padding:'12px', borderRadius:10, fontWeight:700, cursor:'pointer' }}>Got it</button>
      </Sheet>

      {/* Profiles info */}
      <Sheet open={infoOpen} onClose={()=>setInfoOpen(false)} title="About profiles">
        <div style={{ color:'#e5e7eb', fontSize:12, lineHeight:1.7 }}>
          <p style={{ margin:'0 0 10px' }}>A profile stores a preferred country, region and web transport. It can connect only to servers actually listed in your directory.</p>
          <p style={{ margin:'0 0 10px' }}>Tap a profile to open its details, then Edit to change name, colour, icon and settings. Duplicate makes a copy you can tweak; Delete removes it from this device.</p>
          <p style={{ margin:'0 0 10px' }}>Profiles are saved locally on this device. DNS filtering, NAT, LAN and device-wide VPN settings are not applied by the web client.</p>
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
