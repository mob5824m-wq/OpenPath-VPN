export type ReleaseAsset = { id:number; name:string; size?:number; browser_download_url:string }
export type Release = {
  id:number; tag_name:string; name?:string; body?:string; published_at?:string|null
  html_url:string; prerelease?:boolean; assets:ReleaseAsset[]
}
export type ReleaseFeed = { releases:Release[]; stale:boolean; warning?:string; source:'server'|'github' }

const API = 'https://api.github.com/repos/mob5824m-wq/OpenPath-VPN/releases?per_page=30'
const REPO_RELEASES = '/mob5824m-wq/OpenPath-VPN/releases/'

function validGithubUrl(value:unknown):value is string {
  if(typeof value !== 'string') return false
  try{
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'github.com' &&
      !url.username && !url.password && url.pathname.startsWith(REPO_RELEASES)
  }catch{ return false }
}

export function normalizeReleases(value:unknown):Release[] {
  if(!Array.isArray(value)) throw new Error('Invalid release response')
  return value.flatMap((item:any)=>{
    if(!item || item.draft || !Number.isSafeInteger(item.id) || typeof item.tag_name !== 'string' || !validGithubUrl(item.html_url)) return []
    const assets = Array.isArray(item.assets) ? item.assets.flatMap((asset:any)=>{
      if(!asset || !Number.isSafeInteger(asset.id) || typeof asset.name !== 'string' ||
         (asset.state && asset.state !== 'uploaded') || !validGithubUrl(asset.browser_download_url)) return []
      return [{id:asset.id, name:asset.name, size:typeof asset.size === 'number' ? asset.size : 0, browser_download_url:asset.browser_download_url}]
    }) : []
    return [{id:item.id, tag_name:item.tag_name, name:typeof item.name === 'string' ? item.name : '',
      body:typeof item.body === 'string' ? item.body : '', published_at:typeof item.published_at === 'string' ? item.published_at : null,
      html_url:item.html_url, prerelease:!!item.prerelease, assets}]
  })
}

export const PLATFORM_FILTERS = [
  { id:'all', label:'All', match:(_name:string)=>true },
  { id:'windows', label:'Windows', match:(n:string)=>/\.(exe|msi)$/i.test(n) || /(^|[-_ ])(win|windows)([-_. ]|$)/i.test(n) },
  { id:'macos', label:'macOS', match:(n:string)=>/\.(dmg|pkg)$/i.test(n) || /(^|[-_ ])(macos|mac|darwin)([-_. ]|$)/i.test(n) },
  { id:'linux', label:'Linux', match:(n:string)=>/\.(deb|rpm|appimage)$/i.test(n) || /(^|[-_ ])linux([-_. ]|$)/i.test(n) },
  { id:'android', label:'Android', match:(n:string)=>/\.(apk|aab)$/i.test(n) || /(^|[-_ ])android([-_. ]|$)/i.test(n) },
  { id:'ios', label:'iOS', match:(n:string)=>/\.ipa$/i.test(n) || /(^|[-_ ])ios([-_. ]|$)/i.test(n) },
  { id:'web', label:'Web', match:(n:string)=>/(^|[-_ ])web([-_. ]|$)/i.test(n) },
  { id:'server', label:'Server', match:(n:string)=>/(^|[-_ ])server([-_. ]|$)/i.test(n) },
]

// Prefer the server's cached GitHub feed; a release page still works when an
// older backend does not have the endpoint or the backend is offline.
export async function loadReleaseFeed(force:boolean, signal:AbortSignal):Promise<ReleaseFeed> {
  let serverError = ''
  try{
    const response = await fetch(`/api/releases${force ? '?refresh=1' : ''}`, {signal})
    if(!response.ok){
      let message = `Release service returned HTTP ${response.status}`
      try{ const body = await response.json(); if(typeof body?.error === 'string') message = body.error }catch{}
      throw new Error(message)
    }
    const body = await response.json()
    return {releases:normalizeReleases(body?.releases), stale:!!body?.stale,
      warning:typeof body?.warning === 'string' ? body.warning : undefined, source:'server'}
  }catch(error:any){
    if(signal.aborted) throw error
    serverError = error?.message || 'Release service unavailable'
  }
  try{
    const response = await fetch(API, {signal, headers:{accept:'application/vnd.github+json'}})
    if(!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`)
    return {releases:normalizeReleases(await response.json()), stale:false, source:'github'}
  }catch(error:any){
    if(signal.aborted) throw error
    throw new Error(`${error?.message || 'Could not reach GitHub'} (${serverError})`)
  }
}
