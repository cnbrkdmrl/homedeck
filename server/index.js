// HomeDeck hub: collector'lari calistirir, SSE ile istemcilere yayar, statik arayuzu sunar.
import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectors } from './collectors/index.js';
import { createLayoutStore } from './layout-store.js';
import { createNetGuard } from './netguard.js';
import { createSessionStore } from './sessions.js';
import { createQuotaStore } from './quotas.js';
import { createPushStore } from './push.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const LAYOUT = process.env.LAYOUT_FILE || path.join(ROOT, 'config', 'layout.json');
const PORT = Number(process.env.PORT || 8787);
const TOKEN = process.env.ACCESS_TOKEN || ''; // bos ise auth yok (sadece LAN/Tailscale'de kullan)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// state[name] = { data, ts, stale, simulated, error }
const state = {};
const clients = new Set();

function send(res, event, payload) {
  res.write('event: ' + event + '\ndata: ' + JSON.stringify(payload) + '\n\n');
}
function broadcast(event, payload) {
  for (const res of clients) send(res, event, payload);
}

// ---------- Ag korumasi ----------
// ALLOWED_CIDRS: virgulle ayrilmis aralik listesi. Varsayilan: ozel ag araliklari (10/8, 172.16/12, 192.168/16) + localhost.
// Baska ag eklemek icin ornek: "192.168.0.0/16,127.0.0.0/8,::1/128,100.64.0.0/10" (Tailscale)
// Iki ayri yon, iki ayri liste:
//  - VIEWER_CIDRS: hub'in VERI CIKARDIGI cihazlar (arayuz, API, canli akis, duzen, PIN). Ekran cihazinin sabit IP'si (/32) buraya.
//  - INGEST_CIDRS: hub'a VERI GONDEREN agent'lar (bilgisayarlar, sunucu). Ayrica token ile korunur.
// Ikisi de verilmezse ALLOWED_CIDRS, o da yoksa varsayilan kullanilir.
const viewerGuard = createNetGuard(process.env.VIEWER_CIDRS || process.env.ALLOWED_CIDRS);
const ingestGuard = createNetGuard(process.env.INGEST_CIDRS || process.env.ALLOWED_CIDRS);
const BIND_HOST = process.env.BIND_HOST || '0.0.0.0'; // istersen sadece LAN IP'ne bagla (ornek: 192.168.x.y)

// ---------- Ekran duzeni (duzenleme modu bunu yazar) ----------
// Duzenleme PIN'i: EDIT_PIN (varsayilan yok: ayarlanmazsa duzenleme kapali). Sadece LAN/Tailscale'de kullan; PIN zayif bir korumadir.
const layoutStore = createLayoutStore({
  defaultFile: LAYOUT,
  dataDir: process.env.DATA_DIR || path.join(ROOT, 'data'),
  pin: process.env.EDIT_PIN || '',
  broadcast,
});

// ---------- Makineler (agent'lardan gelen veri) ----------
// AGENT_TOKENS="laptop:token1,desktop:token2,server:token3"  (token -> makine kimligi)
const AGENT_TOKENS = new Map();
for (const pair of (process.env.AGENT_TOKENS || '').split(',')) {
  const i = pair.indexOf(':');
  if (i > 0) AGENT_TOKENS.set(pair.slice(i + 1).trim(), pair.slice(0, i).trim());
}
const OPEN_INGEST = AGENT_TOKENS.size === 0;
if (OPEN_INGEST) console.warn('UYARI: AGENT_TOKENS bos, agent verisi dogrulamasiz kabul ediliyor (sadece gelistirme icin).');
const OFFLINE_MS = 20000;
const HIST = 90;
const machines = { hosts: {} };
for (const host of AGENT_TOKENS.values()) machines.hosts[host] = { id: host, label: host, online: false, seen: 0 };

function pushHist(arr, v) {
  arr.push(v === null || v === undefined ? 0 : +Number(v).toFixed(2));
  if (arr.length > HIST) arr.shift();
}
function publishMachines() {
  state.machines = { data: machines, ts: Date.now(), stale: false, simulated: false, error: null };
  broadcast('update', { name: 'machines', entry: state.machines });
}
function ingest(hostId, b) {
  const id = String(hostId).slice(0, 40);
  const h = machines.hosts[id] || (machines.hosts[id] = { id: id });
  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
  h.label = String(b.label || id).slice(0, 40);
  h.os = String(b.os || '').slice(0, 20);
  h.cores = num(b.cores);
  h.cpu = num(b.cpu);
  h.mem = { total: num(b.mem && b.mem.total), used: num(b.mem && b.mem.used) };
  h.disks = (Array.isArray(b.disks) ? b.disks : []).slice(0, 16).map((d) => ({
    name: String(d.name || '?').slice(0, 40), total: num(d.total), used: num(d.used), usb: d.usb === true,
  }));
  // Ek metrikler (agent'in extra-metrics.mjs'i): her alan ayri ayri doğrulanir, bozuk/eksik olan atlanir
  const ex = b.extra && typeof b.extra === 'object' ? b.extra : {};
  const opt = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
  h.gpus = (Array.isArray(ex.gpus) ? ex.gpus : []).slice(0, 4).map((g) => ({
    name: String((g && g.name) || 'GPU').slice(0, 40),
    util: opt(g && g.util) === null ? null : Math.max(0, Math.min(100, g.util)),
    memUsed: opt(g && g.memUsed), memTotal: opt(g && g.memTotal), temp: opt(g && g.temp), power: opt(g && g.power),
  }));
  const bt = ex.battery;
  h.battery = bt && typeof bt === 'object' && opt(bt.pct) !== null
    ? { pct: Math.max(0, Math.min(100, bt.pct)), charging: bt.charging === true, plugged: bt.plugged === true } : null;
  h.procs = (Array.isArray(ex.procs) ? ex.procs : []).slice(0, 8)
    .map((p) => ({ name: String((p && p.name) || '?').slice(0, 30), mem: num(p && p.mem) }))
    .filter((p) => p.mem > 0);
  h.rx = num(b.rx);
  h.tx = num(b.tx);
  h.uptime = num(b.uptime);
  h.temp = typeof b.temp === 'number' ? b.temp : null;
  h.seen = Date.now();
  h.online = true;
  h.hist = h.hist || { cpu: [], rx: [], tx: [] };
  pushHist(h.hist.cpu, h.cpu);
  pushHist(h.hist.rx, h.rx);
  pushHist(h.hist.tx, h.tx);
  publishMachines();
}
setInterval(() => {
  let changed = false;
  for (const h of Object.values(machines.hosts)) {
    if (h.online && Date.now() - h.seen > OFFLINE_MS) { h.online = false; changed = true; }
  }
  if (changed) publishMachines();
}, 5000);

function handleIngest(req, res) {
  const header = req.headers['authorization'] || '';
  const tok = header.startsWith('Bearer ') ? header.slice(7) : '';
  let chunks = '';
  req.on('data', (c) => {
    chunks += c;
    if (chunks.length > 65536) req.destroy();
  });
  req.on('end', () => {
    let body;
    try { body = JSON.parse(chunks); } catch (e) { res.writeHead(400).end('bad json'); return; }
    let hostId;
    if (OPEN_INGEST) hostId = body.host;
    else hostId = AGENT_TOKENS.get(tok); // kimlik token'dan gelir, govdeden degil
    if (!hostId) { res.writeHead(401).end('Unauthorized'); return; }
    ingest(hostId, body);
    res.writeHead(204).end();
  });
}

// ---------- AI oturumlari (Claude Code kancalari -> POST /api/session) ----------
const sessionStore = createSessionStore();
function publishSessions() {
  state.sessions = { data: { sessions: sessionStore.list(), live: true }, ts: Date.now(), stale: false, simulated: false, error: null };
  broadcast('update', { name: 'sessions', entry: state.sessions });
}
setInterval(() => { if (sessionStore.sweep()) publishSessions(); }, 30000);

function handleSession(req, res) {
  const header = req.headers['authorization'] || '';
  const tok = header.startsWith('Bearer ') ? header.slice(7) : '';
  let chunks = '';
  req.on('data', (c) => {
    chunks += c;
    if (chunks.length > 16384) req.destroy();
  });
  req.on('end', () => {
    let body;
    try { body = JSON.parse(chunks); } catch (e) { res.writeHead(400).end('bad json'); return; }
    const hostId = OPEN_INGEST ? body.host : AGENT_TOKENS.get(tok); // kimlik token'dan gelir
    if (!hostId) { res.writeHead(401).end('Unauthorized'); return; }
    if (sessionStore.update(String(hostId).slice(0, 40), body)) publishSessions();
    res.writeHead(204).end();
  });
}

// ---------- AI kotalari (agent'lar yuzdeleri POST /api/quota ile yollar; token'lar makineden cikmaz) ----------
const quotaStore = createQuotaStore(path.join(process.env.DATA_DIR || path.join(ROOT, 'data'), 'quotas.json'));
function publishQuotas() {
  state.quotas = { data: { providers: quotaStore.list() }, ts: Date.now(), stale: false, simulated: false, error: null };
  broadcast('update', { name: 'quotas', entry: state.quotas });
}
setInterval(() => { if (quotaStore.sweep()) publishQuotas(); }, 3600000);

function handleQuota(req, res) {
  const header = req.headers['authorization'] || '';
  const tok = header.startsWith('Bearer ') ? header.slice(7) : '';
  let chunks = '';
  req.on('data', (c) => {
    chunks += c;
    if (chunks.length > 32768) req.destroy();
  });
  req.on('end', () => {
    let body;
    try { body = JSON.parse(chunks); } catch (e) { res.writeHead(400).end('bad json'); return; }
    const hostId = OPEN_INGEST ? body.host : AGENT_TOKENS.get(tok); // kimlik token'dan gelir
    if (!hostId) { res.writeHead(401).end('Unauthorized'); return; }
    if (quotaStore.update(String(hostId).slice(0, 40), body)) publishQuotas();
    res.writeHead(204).end();
  });
}

// ---------- Webhook: disaridan deger/bildirim (POST /api/push) ----------
// Yetki: AGENT_TOKENS'taki herhangi bir token ya da PUSH_TOKEN (Bearer). Ornek:
//   curl -X POST http://HUB:8787/api/push -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
//        -d '{"id":"yedek","label":"Yedek","value":98,"unit":"%","level":"ok","title":"Yedek bitti","text":"12 GB"}'
const PUSH_TOKEN = process.env.PUSH_TOKEN || '';
const pushStore = createPushStore(path.join(process.env.DATA_DIR || path.join(ROOT, 'data'), 'push.json'));
function publishPush() {
  state.push = { data: pushStore.list(), ts: Date.now(), stale: false, simulated: false, error: null };
  broadcast('update', { name: 'push', entry: state.push });
}
setInterval(() => { if (pushStore.sweep()) publishPush(); }, 30000);

function handlePush(req, res) {
  const header = req.headers['authorization'] || '';
  const tok = header.startsWith('Bearer ') ? header.slice(7) : '';
  const ok = !!tok && ((PUSH_TOKEN && tok === PUSH_TOKEN) || AGENT_TOKENS.has(tok));
  if (!ok && !OPEN_INGEST) { res.writeHead(401).end('Unauthorized'); return; }
  let chunks = '';
  req.on('data', (c) => {
    chunks += c;
    if (chunks.length > 8192) req.destroy();
  });
  req.on('end', () => {
    let body;
    try { body = JSON.parse(chunks); } catch (e) { res.writeHead(400).end('bad json'); return; }
    if (!pushStore.update(body)) { res.writeHead(422).end('gecersiz govde: value (+id/label) ya da title/text gerekli'); return; }
    publishPush();
    res.writeHead(204).end();
  });
}

async function runCollector(c) {
  try {
    const out = await c.run(state[c.name] && state[c.name].data);
    state[c.name] = {
      data: out.data,
      ts: Date.now(),
      stale: false,
      simulated: !!out.simulated,
      error: null,
    };
  } catch (err) {
    const prev = state[c.name] || {};
    state[c.name] = {
      data: prev.data || null,
      ts: prev.ts || 0,
      stale: true,
      simulated: !!prev.simulated,
      error: String(err && err.message ? err.message : err),
    };
    console.warn('[' + c.name + '] hata:', state[c.name].error);
  }
  broadcast('update', { name: c.name, entry: state[c.name] });
}

publishMachines();
if (process.env.DEMO_SESSIONS !== '1') publishSessions(); // demo kapaliysa gercek (bos) liste ile basla
if (process.env.DEMO_QUOTAS !== '1') publishQuotas();     // kota: ayni sekilde
publishPush();

for (const c of collectors) {
  const loop = async () => {
    await runCollector(c);
    setTimeout(loop, c.interval);
  };
  loop();
}

function authorized(req, url) {
  if (!TOKEN) return true;
  const header = req.headers['authorization'] || '';
  if (header === 'Bearer ' + TOKEN) return true;
  return url.searchParams.get('token') === TOKEN;
}

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404).end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(buf);
  });
}


// ---------- Agent guncelleme dosyalari (Windows'taki GUNCELLE.bat bunlari ceker) ----------
// Yalniz AGENT_TOKENS'taki token'la ve ingest agindan (ingestGuard) erisilir; yalniz asagidaki beyaz listedeki dosyalar sunulur.
const AGENT_DIR = process.env.AGENT_DIR || path.join(ROOT, 'agent');
const AGENT_FILES = ['agent.js', 'quota-readers.mjs', 'claude-usage.mjs', 'extra-metrics.mjs', 'update-windows.ps1', 'GUNCELLE.bat'];
function handleAgentFiles(req, res, url) {
  const header = req.headers['authorization'] || '';
  const tok = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (OPEN_INGEST || !AGENT_TOKENS.has(tok)) { res.writeHead(401).end('Unauthorized'); return; }
  const send = (code, type, body) => res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }).end(body);
  try {
    if (url.pathname === '/api/agent/manifest') {
      const files = {};
      for (const n of AGENT_FILES) {
        try { const b = fs.readFileSync(path.join(AGENT_DIR, n)); files[n] = { sha256: crypto.createHash('sha256').update(b).digest('hex'), size: b.length }; } catch (e) { /* dosya yok: listeye girmez */ }
      }
      send(200, 'application/json', JSON.stringify({ files }));
      return;
    }
    const name = decodeURIComponent(url.pathname.slice('/api/agent/file/'.length));
    if (!AGENT_FILES.includes(name)) { send(404, 'text/plain', 'not found'); return; }
    send(200, 'application/octet-stream', fs.readFileSync(path.join(AGENT_DIR, name)));
  } catch (e) { send(404, 'text/plain', 'not found'); }
}

const server = http.createServer((req, res) => {
  // Ag korumasi: ev agi disindan gelen HER istegi (arayuz, API, SSE, agent) reddet.
  const reqPath = String(req.url || '').split('?')[0];
  const isAgentFile = req.method === 'GET' && (reqPath === '/api/agent/manifest' || reqPath.startsWith('/api/agent/file/'));
  const isIngest = isAgentFile || (req.method === 'POST' && (reqPath === '/api/ingest' || reqPath === '/api/session' || reqPath === '/api/quota' || reqPath === '/api/push'));
  const guard = isIngest ? ingestGuard : viewerGuard;
  if (!guard.allowed(req.socket.remoteAddress)) {
    guard.logBlocked(req.socket.remoteAddress, isIngest ? 'agent' : 'goruntuleme');
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Forbidden: yalnizca ev agindan erisilebilir');
    return;
  }
  const url = new URL(req.url, 'http://localhost');

  if (isAgentFile) {
    handleAgentFiles(req, res, url); // kendi token'ini kullanir (AGENT_TOKENS)
    return;
  }

  if (url.pathname === '/api/push' && req.method === 'POST') {
    handlePush(req, res); // kendi token'ini kullanir (AGENT_TOKENS ya da PUSH_TOKEN)
    return;
  }
  if (url.pathname === '/api/quota' && req.method === 'POST') {
    handleQuota(req, res); // kendi token'ini kullanir (AGENT_TOKENS)
    return;
  }
  if (url.pathname === '/api/session' && req.method === 'POST') {
    handleSession(req, res); // kendi token'ini kullanir (AGENT_TOKENS)
    return;
  }
  if (url.pathname === '/api/ingest' && req.method === 'POST') {
    handleIngest(req, res); // kendi token'ini kullanir (AGENT_TOKENS)
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    if (!authorized(req, url)) {
      res.writeHead(401).end('Unauthorized');
      return;
    }
    if (url.pathname === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, uptime: process.uptime(), clients: clients.size }));
      return;
    }
    if (url.pathname === '/api/layout' || url.pathname === '/api/edit/verify') {
      layoutStore.handle(req, res, url);
      return;
    }
    if (url.pathname === '/api/snapshot') {
      res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify(state));
      return;
    }
    if (url.pathname === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write('retry: 3000\n\n');
      send(res, 'snapshot', state);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    res.writeHead(404).end('Not found');
    return;
  }

  serveStatic(req, res, url);
});

setInterval(() => {
  for (const res of clients) res.write(': ping\n\n');
}, 15000);

server.listen(PORT, BIND_HOST, () => {
  console.log('HomeDeck hazir: http://' + (BIND_HOST === '0.0.0.0' ? 'localhost' : BIND_HOST) + ':' + PORT +
    '\n  veri cikisi (arayuz/API) izinli: ' + (process.env.VIEWER_CIDRS || process.env.ALLOWED_CIDRS || 'varsayilan ozel ag araliklari + localhost') +
    '\n  agent girisi izinli:           ' + (process.env.INGEST_CIDRS || process.env.ALLOWED_CIDRS || 'varsayilan ozel ag araliklari + localhost'));
});
