// Servis kontrolu: istenen adreslere duzenli istek atip ayakta mi ve ne kadar hizli diye bakar (yalniz okuma).
// SERVICES="Gitea=http://127.0.0.1:3000,Router=http://ROUTER_IP,SSH=tcp://127.0.0.1:22"  (ad=adres, virgulle; en cok 8)
//  - http(s)://: herhangi bir cevap (5xx haric; 401/403/404/302 de "ayakta") ayakta sayilir. Sertifikasi gecersiz https icin tcp:// kullan.
//  - tcp://host:port: baglanti kurulabiliyorsa ayakta.
// Bos birakirsan collector kayit edilmez.
import net from 'node:net';

const MAX = 8;
const HIST = 60;
const TIMEOUT_MS = 4000;
const SLOW_MS = 1500;

// "Ad=adres,Ad2=adres" -> [{ name, url, kind }] (saf fonksiyon, test edilir). Gecersiz girdiler atlanir.
export function parseServices(spec) {
  const out = [];
  for (const part of String(spec || '').split(',')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const name = part.slice(0, i).trim().slice(0, 24);
    const raw = part.slice(i + 1).trim();
    let u;
    try { u = new URL(raw); } catch (e) { continue; }
    if (!name) continue;
    if (u.protocol === 'http:' || u.protocol === 'https:') out.push({ name, url: raw, kind: 'http' });
    else if (u.protocol === 'tcp:' && u.hostname && u.port) out.push({ name, url: raw, kind: 'tcp', host: u.hostname.replace(/^\[|\]$/g, ''), port: Number(u.port) });
    if (out.length >= MAX) break;
  }
  return out;
}

// Gecmis dizisine yeni olcum ekle (saf fonksiyon): ms ya da null (ulasilamadi)
export function pushHist(hist, ms) {
  const h = hist.concat([ms]);
  return h.length > HIST ? h.slice(h.length - HIST) : h;
}

// Durum: down | slow | up (saf fonksiyon)
export function statusOf(up, ms) {
  return !up ? 'down' : ms >= SLOW_MS ? 'slow' : 'up';
}

function checkHttp(s) {
  const t0 = performance.now();
  return fetch(s.url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'User-Agent': 'homedeck' } })
    .then((r) => { r.body && r.body.cancel().catch(() => {}); return { up: r.status < 500, ms: Math.round(performance.now() - t0), code: r.status }; })
    .catch((e) => ({ up: false, ms: null, code: null, err: e && e.name === 'TimeoutError' ? 'zaman aşımı' : 'ulaşılamıyor' }));
}

function checkTcp(s) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const sock = net.connect({ host: s.host, port: s.port });
    const done = (r) => { sock.destroy(); resolve(r); };
    sock.setTimeout(TIMEOUT_MS, () => done({ up: false, ms: null, code: null, err: 'zaman aşımı' }));
    sock.once('connect', () => done({ up: true, ms: Math.round(performance.now() - t0), code: null }));
    sock.once('error', () => done({ up: false, ms: null, code: null, err: 'ulaşılamıyor' }));
  });
}

const LIST = parseServices(process.env.SERVICES);
const hist = new Map();

export const hasServices = LIST.length > 0;

export default {
  name: 'services',
  interval: 15000,
  async run() {
    const res = await Promise.all(LIST.map((s) => (s.kind === 'tcp' ? checkTcp(s) : checkHttp(s))));
    const services = LIST.map((s, i) => {
      const r = res[i];
      const h = pushHist(hist.get(s.name) || [], r.up ? r.ms : null);
      hist.set(s.name, h);
      return { name: s.name, kind: s.kind, status: statusOf(r.up, r.ms), ms: r.ms, code: r.code, err: r.err || null, hist: h };
    });
    return { data: { services }, simulated: false };
  },
};
