import { Router } from 'express';
import { listHosts, registerHost, heartbeat, unregister, allHosts } from './registry.js';

export const hostsRouter = Router();

// GET /api/hosts — app connects to main, gets list of available sub-hosts
// ?all=1 to include offline, ?region=us-east filter
hostsRouter.get('/hosts', (req, res) => {
  const includeOffline = req.query.all === '1' || req.query.all === 'true';
  const regionFilter = (req.query.region as string) || '';
  const data = listHosts({ includeOffline });
  let hosts = data.hosts;
  if (regionFilter) hosts = hosts.filter(h => h.region === regionFilter);
  res.json({ ...data, hosts, filtered: !!regionFilter });
});

// GET /api/hosts/stats — for dashboard
hostsRouter.get('/hosts/stats', (_req, res) => {
  const data = listHosts({ includeOffline: true });
  res.json({
    main: data.main,
    total: data.total,
    online: data.online,
    hosts: data.hosts,
    all: allHosts(),
  });
});

// POST /api/hosts/register — sub-host POSTs to register itself with main
// Body: { id?, name?, host?, port?, wssUrl?, region?, country?, flag?, capacity? }
hostsRouter.post('/hosts/register', (req, res) => {
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || req.socket.remoteAddress || 'unknown';
  const payload = req.body || {};
  // allow host override: prefer payload.host, else req ip
  try {
    const { entry, isNew } = registerHost(payload, ip.replace(/^::ffff:/, ''));
    console.log(`[hosts] ${isNew ? 'registered' : 'updated'} sub ${entry.id} ${entry.host}:${entry.port} region=${entry.region} wss=${entry.wssUrl}`);
    res.json({ ok: true, host: entry, isNew, message: isNew ? 'registered' : 'updated' });
  } catch (e: any) {
    res.status(400).json({ ok: false, error: e?.message || 'register failed' });
  }
});

// POST /api/hosts/heartbeat — sub refreshes lastSeen
hostsRouter.post('/hosts/heartbeat', (req, res) => {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ ok: false, error: 'id required' });
  const h = heartbeat(id);
  if (!h) return res.status(404).json({ ok: false, error: 'unknown host id' });
  res.json({ ok: true, host: h, renewed: true });
});

// POST /api/hosts/unregister
hostsRouter.post('/hosts/unregister', (req, res) => {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ ok: false, error: 'id required' });
  const ok = unregister(id);
  if (!ok) return res.status(404).json({ ok: false, error: 'not found' });
  console.log(`[hosts] unregistered ${id}`);
  res.json({ ok: true });
});

// For debugging: GET /api/hosts/:id
hostsRouter.get('/hosts/:id', (req, res) => {
  const data = listHosts({ includeOffline: true });
  const h = data.hosts.find(x => x.id === req.params.id) || allHosts().find(x => x.id === req.params.id);
  if (!h) return res.status(404).json({ error: 'not found' });
  res.json(h);
});

export default hostsRouter;
