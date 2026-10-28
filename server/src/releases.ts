const RELEASES_API = 'https://api.github.com/repos/mob5824m-wq/OpenPath-VPN/releases?per_page=30';
const REPO_PATH = '/mob5824m-wq/OpenPath-VPN/releases/';
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const CACHE_MS = 60_000;

export interface ReleaseAsset {
  id: number;
  name: string;
  size: number;
  browser_download_url: string;
}
export interface Release {
  id: number;
  tag_name: string;
  name: string;
  body: string;
  published_at: string | null;
  html_url: string;
  prerelease: boolean;
  assets: ReleaseAsset[];
}
export interface ReleaseResult {
  releases: Release[];
  stale: boolean;
  warning?: string;
}

function githubReleaseUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'github.com' &&
      !url.username && !url.password && url.pathname.startsWith(REPO_PATH);
  } catch { return false; }
}

function normalizeReleases(value: unknown): Release[] {
  if (!Array.isArray(value)) throw new Error('GitHub returned an invalid release list');
  return value.flatMap((item: any) => {
    if (!item || item.draft || !Number.isSafeInteger(item.id) ||
        typeof item.tag_name !== 'string' || !githubReleaseUrl(item.html_url)) return [];
    const assets: ReleaseAsset[] = Array.isArray(item.assets) ? item.assets.flatMap((asset: any) => {
      if (!asset || !Number.isSafeInteger(asset.id) || typeof asset.name !== 'string' ||
          (asset.state && asset.state !== 'uploaded') || !githubReleaseUrl(asset.browser_download_url)) return [];
      return [{ id: asset.id, name: asset.name.slice(0, 255), size: Number.isSafeInteger(asset.size) ? asset.size : 0,
        browser_download_url: asset.browser_download_url }];
    }) : [];
    return [{
      id: item.id, tag_name: item.tag_name.slice(0, 128),
      name: typeof item.name === 'string' ? item.name.slice(0, 256) : '',
      body: typeof item.body === 'string' ? item.body.slice(0, 20_000) : '',
      published_at: typeof item.published_at === 'string' ? item.published_at : null,
      html_url: item.html_url, prerelease: !!item.prerelease, assets,
    }];
  });
}

async function boundedJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get('content-length'));
  if (declared > MAX_RESPONSE_BYTES) throw new Error('GitHub release response was too large');
  if (!response.body) throw new Error('GitHub returned an empty response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error('GitHub release response was too large');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('GitHub returned invalid JSON'); }
}

// One cache per server process reduces GitHub's unauthenticated API rate usage.
// The URL is fixed: this endpoint must never become a general-purpose proxy.
export class ReleaseService {
  private cached: { releases: Release[]; etag: string | null; fetchedAt: number } | null = null;
  private inFlight: Promise<ReleaseResult> | null = null;

  constructor(private readonly request: typeof fetch = fetch, private readonly now = Date.now) {}

  async get(force = false): Promise<ReleaseResult> {
    if (!force && this.cached && this.now() - this.cached.fetchedAt < CACHE_MS) {
      return { releases: this.cached.releases, stale: false };
    }
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.refresh().catch(error => {
      const message = error instanceof Error ? error.message : 'Could not reach GitHub';
      if (this.cached) return { releases: this.cached.releases, stale: true, warning: message };
      throw new Error(message);
    }).finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  private async refresh(): Promise<ReleaseResult> {
    const headers: Record<string, string> = {
      accept: 'application/vnd.github+json', 'user-agent': 'OpenPath-VPN-release-browser',
      'x-github-api-version': '2022-11-28',
    };
    if (this.cached?.etag) headers['if-none-match'] = this.cached.etag;
    let response: Response;
    try {
      response = await this.request(RELEASES_API, { headers, redirect: 'error', signal: AbortSignal.timeout(8_000) });
    } catch { throw new Error('Could not reach GitHub; check the server network connection'); }
    if (response.status === 304 && this.cached) {
      this.cached.fetchedAt = this.now();
      return { releases: this.cached.releases, stale: false };
    }
    if (!response.ok) {
      if (response.status === 403 || response.status === 429) throw new Error('GitHub API rate limit or access restriction; try again later');
      throw new Error(`GitHub returned HTTP ${response.status}`);
    }
    const releases = normalizeReleases(await boundedJson(response));
    this.cached = { releases, etag: response.headers.get('etag'), fetchedAt: this.now() };
    return { releases, stale: false };
  }
}
