import React, { useEffect, useRef, useState } from 'react'

export type DeviceStatus = {
  state:'active'|'inactive'|'stopped'|'unknown'|'unsupported'
  configured:boolean; owned:boolean; installed:boolean; interface:string; message?:string
}
export type DeviceVpnBridge = {
  status:()=>Promise<DeviceStatus>
  importProfile:()=>Promise<{canceled?:boolean; configured?:boolean; endpoint?:string; hasIPv6Address?:boolean}>
  removeProfile:()=>Promise<unknown>
  connect:(options:{dnsMode:string; customDns:string})=>Promise<DeviceStatus>
  disconnect:()=>Promise<DeviceStatus>
}

const button:React.CSSProperties = {background:'#1a1a24', border:'1px solid #3a3a4a', borderRadius:8, color:'#e5e7eb', padding:'8px 10px', cursor:'pointer', fontSize:11, fontWeight:700}

export default function DeviceVpnPanel({bridge}:{bridge:DeviceVpnBridge}){
  const [status, setStatus] = useState<DeviceStatus|null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState<string|null>(null)
  const [info, setInfo] = useState<string|null>(null)
  const [dnsMode, setDnsMode] = useState('ads')
  const [customDns, setCustomDns] = useState('')

  useEffect(()=>{
    let mounted = true
    const refresh = async()=>{
      if(busyRef.current) return
      try{ const next = await bridge.status(); if(mounted) setStatus(next) }
      catch(e:any){ if(mounted) setError(e?.message || 'Could not read device VPN status') }
    }
    void refresh()
    const timer = setInterval(refresh, 5000)
    return ()=>{ mounted = false; clearInterval(timer) }
  },[bridge])

  const perform = async (action:()=>Promise<unknown>, success:string)=>{
    if(busyRef.current) return
    busyRef.current = true; setBusy(true); setError(null); setInfo(null)
    try{
      const result = await action() as {canceled?:boolean; endpoint?:string; hasIPv6Address?:boolean} | undefined
      const next = await bridge.status(); setStatus(next)
      if(!result?.canceled){
        setInfo(result?.endpoint ? `Profile imported for ${result.endpoint}.${result.hasIPv6Address ? '' : ' Add an IPv6 address on your WireGuard server for working IPv6 traffic.'}` : success)
      }
    }catch(e:any){
      setError((e?.message || 'Device VPN operation failed').replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, ''))
      try{ setStatus(await bridge.status()) }catch{}
    }finally{ busyRef.current = false; setBusy(false) }
  }

  const inactive = status?.state === 'inactive'
  const canStop = status?.owned && (status.state === 'active' || status.state === 'stopped')
  const stateLabel = !status ? 'Checking device VPN…' : status.state === 'active' ? 'WireGuard interface active' :
    status.state === 'inactive' ? 'Device VPN disconnected' : status.state === 'stopped' ? 'WireGuard service stopped' :
    status.state === 'unsupported' ? 'Device VPN unsupported on this system' : 'Device VPN status unavailable'

  return <div style={{background:'#12121a', border:'1px solid #2a2a38', borderRadius:12, padding:12}}>
    <div style={{color:'#fff', fontSize:13, fontWeight:800}}>Device-wide VPN · WireGuard</div>
    <div aria-label="Device VPN status" style={{color:status?.state==='active'?'#a7f3d0':'#d1d5db', fontSize:11, marginTop:6}}>{stateLabel}</div>
    {status?.message && <div style={{color:'#9ca3af', fontSize:10, lineHeight:1.5, marginTop:4}}>{status.message}</div>}
    {status && !status.installed && <div style={{color:'#fbbf24', fontSize:10, lineHeight:1.5, marginTop:5}}>Install WireGuard and its system tools before connecting.</div>}
    <div style={{color:'#9ca3af', fontSize:10, lineHeight:1.5, marginTop:6}}>
      Import a full-tunnel WireGuard profile from your VPN server. This uses a separate UDP tunnel and asks for administrator permission.
    </div>
    <div style={{display:'flex', gap:6, flexWrap:'wrap', marginTop:8}}>
      <button style={button} disabled={busy || !inactive} onClick={()=>perform(()=>bridge.importProfile(), 'Profile imported')}>
        {status?.configured ? 'Replace WireGuard profile' : 'Import WireGuard profile'}
      </button>
      {status?.configured && <button style={button} disabled={busy || !inactive} onClick={()=>perform(()=>bridge.removeProfile(), 'Saved profile removed')}>Remove profile</button>}
    </div>
    <label style={{display:'block', color:'#e5e7eb', fontSize:11, marginTop:10}} htmlFor="device-dns-mode">NetShield / DNS on next connection</label>
    <select id="device-dns-mode" value={dnsMode} disabled={busy || !inactive} onChange={e=>setDnsMode(e.target.value)}
      style={{width:'100%', background:'#1a1a24', border:'1px solid #3a3a4a', color:'#fff', padding:'8px', borderRadius:8, marginTop:4}}>
      <option value="ads">Malware, ads and trackers · AdGuard DNS</option>
      <option value="malware">Malware only · Quad9</option>
      <option value="unfiltered">Unfiltered · profile DNS or Cloudflare</option>
      <option value="custom">Custom DNS</option>
    </select>
    {dnsMode === 'custom' && <label style={{display:'block', color:'#e5e7eb', fontSize:11, marginTop:6}}>Custom DNS IP addresses
      <input aria-label="Custom DNS IP addresses" value={customDns} disabled={busy || !inactive} onChange={e=>setCustomDns(e.target.value)} placeholder="1.1.1.1, 1.0.0.1"
        style={{width:'100%', display:'block', background:'#1a1a24', color:'#fff', border:'1px solid #3a3a4a', padding:'8px', borderRadius:8, marginTop:4}} />
    </label>}
    <div style={{display:'flex', gap:6, marginTop:10}}>
      <button style={{...button, background:'#6d4aff', flex:1}} disabled={busy || !inactive || !status?.configured || !status?.installed}
        onClick={()=>perform(()=>bridge.connect({dnsMode,customDns}), 'WireGuard interface started')}>{busy ? 'Working…' : 'Connect device VPN'}</button>
      <button style={{...button, flex:1}} disabled={busy || !canStop}
        onClick={()=>perform(()=>bridge.disconnect(), 'Device VPN disconnected')}>Disconnect device VPN</button>
    </div>
    {info && <div style={{color:'#a7f3d0', fontSize:10, marginTop:7}}>{info}</div>}
    {error && <div role="alert" style={{color:'#fbbf24', fontSize:11, marginTop:7, overflowWrap:'anywhere'}}>{error}</div>}
    <div style={{color:'#8b8da3', fontSize:10, lineHeight:1.5, marginTop:8}}>
      An active interface does not confirm a successful peer handshake. No kill switch is provided; local-network routes or app-specific encrypted DNS may bypass these settings. The tunnel stays active until disconnected.
    </div>
  </div>
}
