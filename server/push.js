// Disaridan gonderilen degerler ve bildirimler (webhook): herhangi bir script `curl` ile ekrana deger/uyari yollar.
// Degerler id'ye gore tutulur (ayni id ustune yazilir); bildirimler kisa omurlu bir listedir. Kalici: DATA_DIR/push.json
import fs from 'node:fs';
import path from 'node:path';

const MAX_VALUES = 12;
const MAX_NOTES = 20;
const DEFAULT_TTL_MIN = 60;
const MAX_TTL_MIN = 7 * 24 * 60;
const LEVELS = ['info', 'ok', 'warn', 'error'];

const clip = (s, n) => String(s === null || s === undefined ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);
const slug = (s) => clip(s, 40).toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '');

// Govdeyi temizle (saf fonksiyon, test edilir). Donus: { value?, note? } ya da null (gecersiz).
export function parsePush(body, now) {
  if (!body || typeof body !== 'object') return null;
  const out = {};
  const hasValue = body.value !== undefined && body.value !== null && body.value !== '';
  if (hasValue) {
    const id = slug(body.id || body.label || '');
    if (!id) return null;
    const n = Number(body.value);
    out.value = {
      id,
      label: clip(body.label || body.id, 40),
      value: typeof body.value === 'number' || (typeof body.value === 'string' && body.value.trim() !== '' && Number.isFinite(n)) ? n : clip(body.value, 30),
      unit: clip(body.unit, 12),
      sub: clip(body.sub, 60),
      level: LEVELS.includes(body.level) ? body.level : 'info',
      ts: now,
    };
  }
  const text = clip(body.text || body.message, 160);
  const title = clip(body.title, 60);
  if (text || title) {
    const ttl = Math.min(MAX_TTL_MIN, Math.max(1, Number(body.ttl) || DEFAULT_TTL_MIN));
    out.note = { title, text, level: LEVELS.includes(body.level) ? body.level : 'info', ts: now, until: now + ttl * 60000 };
  }
  return out.value || out.note ? out : null;
}

export function createPushStore(file) {
  let values = [];
  let notes = [];
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(j.values)) values = j.values.slice(0, MAX_VALUES);
    if (Array.isArray(j.notes)) notes = j.notes.slice(0, MAX_NOTES);
  } catch (e) { /* ilk calisma */ }
  const save = () => {
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify({ values, notes })); } catch (e) { /* kalici degil: sorun degil */ }
  };
  return {
    update(body, now = Date.now()) {
      const p = parsePush(body, now);
      if (!p) return false;
      if (p.value) {
        values = values.filter((v) => v.id !== p.value.id);
        values.unshift(p.value);
        if (values.length > MAX_VALUES) values.length = MAX_VALUES;
      }
      if (p.note) { notes.unshift(p.note); if (notes.length > MAX_NOTES) notes.length = MAX_NOTES; }
      save();
      return true;
    },
    clear(id) {
      if (id === undefined) { values = []; notes = []; } else values = values.filter((v) => v.id !== id);
      save();
    },
    // Suresi dolan bildirimleri at; degisiklik olduysa true
    sweep(now = Date.now()) {
      const n = notes.length;
      notes = notes.filter((x) => x.until > now);
      if (notes.length !== n) { save(); return true; }
      return false;
    },
    list() { return { values: values.slice(), notes: notes.slice() }; },
  };
}
