// Claude Code izin istekleri (PermissionRequest kancası -> hub -> iPad). Yalnızca bellekte tutulur.
//
// Güvenlik ilkeleri:
//  - Kimsenin kendiliğinden "izin ver" dediği bir yol yok: yalnızca bekleyen (pending) bir istek, açıkça
//    verilen bir karar ve süresi dolmamış olması gerekir. Her belirsizlikte kanca hiçbir karar yazmaz ve
//    Claude Code normal onay penceresine döner.
//  - Kimlikler tahmin edilemez (96 bit rastgele). Karar sorgusu yalnızca isteği açan makineye cevap verir.
//  - Gösterilen özet kısa, tek satır ve sırlardan arındırılmıştır; dosya içeriği hiç gelmez.
import crypto from 'node:crypto';

export const TTL_MS = 90 * 1000;       // kanca en çok bu kadar bekler, sonra normal pencereye döner
const KEEP_MS = 60 * 1000;             // bitmiş kayıt bu kadar sonra silinir (kanca son cevabı okuyabilsin)
const MAX_PENDING = 20;

const clip = (v, n) => String(v === null || v === undefined ? '' : v).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

// Özetteki bariz sırları gizle (kanca da yapar; ikinci kat güvenlik)
export function maskSecrets(s) {
  return String(s)
    .replace(/\b(sk|pk|ghp|gho|ghs|github_pat|xox[abpr]|AKIA)[-_A-Za-z0-9]{12,}/g, '$1•••')
    .replace(/\b(token|key|secret|passw(?:or)?d|pwd|auth|bearer)(\s*[=:]\s*|\s+)\S{4,}/gi, '$1$2•••');
}

export function createApprovalStore({ ttlMs = TTL_MS, max = MAX_PENDING } = {}) {
  const map = new Map();

  function create(host, b) {
    let pending = 0;
    for (const a of map.values()) if (a.status === 'pending') pending++;
    if (pending >= max) return null;
    const tool = clip(b && b.tool, 30);
    if (!tool) return null;
    const now = Date.now();
    const id = crypto.randomBytes(12).toString('hex');
    map.set(id, {
      id, host: clip(host, 40), project: clip(b.project, 40), tool,
      summary: maskSecrets(clip(b.summary, 160)),
      since: now, expires: now + ttlMs, status: 'pending', doneAt: 0,
    });
    return id;
  }

  // Kanca için durum. Başka makinenin kimliğiyle sorulursa 'unknown' (varlığı sızdırılmaz).
  function status(id, host) {
    const a = map.get(id);
    if (!a || a.host !== host) return 'unknown';
    if (a.status === 'pending' && Date.now() >= a.expires) { a.status = 'expired'; a.doneAt = Date.now(); }
    return a.status;
  }

  // Yalnızca bekleyen ve süresi dolmamış istek karara bağlanır. Dönüş: { tool, host } ya da null.
  function decide(id, decision) {
    if (decision !== 'allow' && decision !== 'deny') return null;
    const a = map.get(id);
    if (!a || a.status !== 'pending' || Date.now() >= a.expires) return null;
    a.status = decision;
    a.doneAt = Date.now();
    return { tool: a.tool, host: a.host };
  }

  function cancel(id, host) {
    const a = map.get(id);
    if (!a || a.host !== host || a.status !== 'pending') return false;
    a.status = 'cancelled';
    a.doneAt = Date.now();
    return true;
  }

  // true = liste değişti
  function sweep() {
    const now = Date.now();
    let changed = false;
    for (const [k, a] of map) {
      if (a.status === 'pending' && now >= a.expires) { a.status = 'expired'; a.doneAt = now; changed = true; }
      else if (a.status !== 'pending' && now - a.doneAt > KEEP_MS) map.delete(k);
    }
    return changed;
  }

  function list() {
    const now = Date.now();
    return [...map.values()].filter((a) => a.status === 'pending' && now < a.expires)
      .sort((x, y) => x.since - y.since)
      .map((a) => ({ id: a.id, host: a.host, project: a.project, tool: a.tool, summary: a.summary, since: a.since, expires: a.expires }));
  }

  return { create, status, decide, cancel, sweep, list };
}
