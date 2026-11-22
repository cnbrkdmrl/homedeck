import fs from 'node:fs';
import path from 'node:path';
// AI kotalari: agent'lar yuzdeleri yollar (token'lar makineden CIKMAZ). Kota HESAP geneli oldugundan ayni saglayici icin
// birden fazla makineden okuma gelebilir; "en tazesi kazanir" (observedAt en yeni olan).
const ORDER = ['claude', 'antigravity', 'codex'];
const MAX_PROVIDERS = 6;
const MAX_LIMITS = 8;
const DROP_MS = 30 * 24 * 3600 * 1000; // 30 gunden eski saglayiciyi listeden dus
const YEAR_MS = 400 * 24 * 3600 * 1000;

const clip = (v, n) => String(v === null || v === undefined ? '' : v).replace(/[\r\n\t]+/g, ' ').trim().slice(0, n);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function cleanProvider(p, now) {
  if (!p || typeof p !== 'object') return null;
  const id = String(p.id || '').toLowerCase();
  if (!/^[a-z0-9_-]{1,20}$/.test(id)) return null;
  let observedAt = num(p.observedAt);
  if (observedAt === null) observedAt = now;
  if (observedAt > now + 5 * 60000) observedAt = now;          // gelecekteki damgayi kirp
  if (observedAt < now - YEAR_MS) return null;                  // cok eski: hic alma
  const limits = [];
  for (const l of (Array.isArray(p.limits) ? p.limits : []).slice(0, MAX_LIMITS)) {
    if (!l || typeof l !== 'object') continue;
    const pct = num(l.percent);
    if (pct === null) continue;
    let resetsAt = num(l.resetsAt);
    if (resetsAt !== null && (resetsAt < now - YEAR_MS || resetsAt > now + YEAR_MS)) resetsAt = null;
    let windowSec = num(l.windowSec);
    if (windowSec !== null && !(windowSec >= 60 && windowSec <= 31 * 86400)) windowSec = null;
    limits.push({
      label: clip(l.label, 30) || 'Limit',
      percent: Math.max(0, Math.min(100, pct)),
      resetsAt,
      windowSec: windowSec === null ? null : Math.round(windowSec),
    });
  }
  return {
    id,
    name: clip(p.name, 24) || id.charAt(0).toUpperCase() + id.slice(1),
    plan: clip(p.plan, 24),
    extra: p.extra ? clip(p.extra, 60) : null,
    limits,
    observedAt,
  };
}

export function createQuotaStore(file) {
  const map = new Map();
  // Hub yeniden baslayinca kotalar bos kalmasin: son durum diskte (DATA_DIR) tutulur, acilista geri yuklenir.
  const save = () => { if (!file) return; try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify([...map.values()])); } catch (e) { /* kalici degil: sorun degil */ } };
  if (file) {
    try {
      const now = Date.now();
      for (const raw of JSON.parse(fs.readFileSync(file, 'utf8'))) { const p = cleanProvider(raw, now); if (p) map.set(p.id, { ...p, source: clip(raw && raw.source, 40) }); }
    } catch (e) { /* ilk calisma */ }
  }

  // true = liste degisti
  function update(host, body, now = Date.now()) {
    const list = body && Array.isArray(body.providers) ? body.providers.slice(0, MAX_PROVIDERS) : [];
    let changed = false;
    for (const raw of list) {
      const p = cleanProvider(raw, now);
      if (!p) continue;
      const cur = map.get(p.id);
      if (cur && p.observedAt < cur.observedAt) continue; // eldekinden eski okuma: yoksay (en tazesi kazanir)
      map.set(p.id, { ...p, source: clip(host, 40) });
      changed = true;
    }
    if (changed) save();
    return changed;
  }

  function sweep(now = Date.now()) {
    let changed = false;
    for (const [id, p] of map) if (now - p.observedAt > DROP_MS) { map.delete(id); changed = true; }
    if (changed) save();
    return changed;
  }

  function list() {
    return [...map.values()].sort((a, b) => {
      const ia = ORDER.indexOf(a.id), ib = ORDER.indexOf(b.id);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || (a.id < b.id ? -1 : 1);
    });
  }

  return { update, sweep, list };
}
