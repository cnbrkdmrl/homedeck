// Takvim: Home Assistant'in takvim varliklarindan (calendar.*) okunur (HA'ya Google/ICS takvimi sen eklersin; ornek: Remote Calendar).
// HA_URL ve HA_TOKEN (uzun omurlu erisim jetonu) .env'de verilir; jeton makineden CIKMAZ, ekrana yalniz etkinlik basliklari gider.
// HA_TOKEN yoksa collector hic kayit edilmez (collectors/index.js).
const HA_URL = (process.env.HA_URL || '').replace(/\/$/, '');
const HA_TOKEN = process.env.HA_TOKEN || '';
const DAYS = Math.max(1, Math.min(60, Number(process.env.CALENDAR_DAYS) || 14));
const MAX_EVENTS = 120;

const clip = (s, n) => String(s === null || s === undefined ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);

// HA etkinligi -> ekran etkinligi. start/end: {dateTime: ISO} (saatli) ya da {date: 'YYYY-MM-DD'} (tum gun, bitis DAHIL DEGIL).
export function normalizeEvent(calId, raw) {
  if (!raw || !raw.start || !raw.end) return null;
  const title = clip(raw.summary, 80) || '(başlıksız)';
  const location = clip(raw.location, 60) || null;
  const uid = clip(raw.uid, 60) + '|' + clip(raw.recurrence_id || (raw.start.dateTime || raw.start.date), 40);
  if (raw.start.date) {
    return { id: calId + '|' + uid, cal: calId, title, location, allDay: true, date: String(raw.start.date).slice(0, 10), endDate: String((raw.end && raw.end.date) || raw.start.date).slice(0, 10) };
  }
  const s = Date.parse(raw.start.dateTime), e = Date.parse(raw.end.dateTime);
  if (!isFinite(s)) return null;
  return { id: calId + '|' + uid, cal: calId, title, location, allDay: false, start: s, end: isFinite(e) ? e : s };
}

async function ha(path) {
  const res = await fetch(HA_URL + path, { headers: { Authorization: 'Bearer ' + HA_TOKEN }, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error('home assistant http ' + res.status + ' (' + path.split('?')[0] + ')');
  return res.json();
}

export default {
  name: 'calendar',
  interval: 5 * 60 * 1000,
  async run() {
    if (!HA_URL || !HA_TOKEN) throw new Error('HA_URL / HA_TOKEN tanımlı değil');
    const cals = await ha('/api/calendars');
    const f = (d) => new Date(d).toISOString().replace(/\.\d+Z$/, 'Z');
    const now = Date.now();
    const q = '?start=' + encodeURIComponent(f(now - 86400000)) + '&end=' + encodeURIComponent(f(now + DAYS * 86400000));
    const calendars = [], events = [], failed = [];
    for (const c of Array.isArray(cals) ? cals.slice(0, 8) : []) {
      const id = String(c.entity_id || '').slice(0, 60);
      if (!id.startsWith('calendar.')) continue;
      calendars.push({ id, name: clip(c.name, 30) || id.slice(9) });
      try {
        const raw = await ha('/api/calendars/' + encodeURIComponent(id) + q);
        for (const r of Array.isArray(raw) ? raw : []) {
          const ev = normalizeEvent(id, r);
          if (ev) events.push(ev);
        }
      } catch (e) {
        failed.push(id);
      }
    }
    if (calendars.length && failed.length === calendars.length) throw new Error('hiçbir takvim okunamadı');
    // sirala: tum gun etkinlikleri kendi gunlerinin basinda, saatliler zamana gore
    const key = (e) => (e.allDay ? Date.parse(e.date + 'T00:00:00Z') : e.start);
    events.sort((a, b) => key(a) - key(b));
    return { data: { calendars, events: events.slice(0, MAX_EVENTS), failed }, simulated: false };
  },
};
