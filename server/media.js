// Calan sarki (agent'tan gelir) ve uzaktan komut kuyrugu (ekrandaki dugmeler -> agent).
// Hub yalnizca agent'in gonderdigi veriyi tutar; komutlar bir sonraki agent istegine (en cok ~3 sn) cevap olarak eklenir.
const ACTIONS = ['playpause', 'next', 'previous'];
const CMD_TTL_MS = 15000;
const STALE_MS = 12000; // agent bu kadar suredir calan sarki bildirmediyse listeden dus

const clip = (s, n) => String(s === null || s === undefined ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);
const secs = (v) => (typeof v === 'number' && isFinite(v) && v >= 0 && v < 86400 * 3 ? v : null);

export function isAction(a) { return ACTIONS.includes(a); }

// Agent'tan gelen "media" nesnesini temizle (saf fonksiyon, test edilir). Gecersizse null.
export function parseMedia(m) {
  if (!m || typeof m !== 'object') return null;
  const state = m.state === 'playing' ? 'playing' : m.state === 'paused' ? 'paused' : null;
  if (!state) return null;
  const title = clip(m.title, 120);
  if (!title) return null;
  const art = typeof m.artwork === 'string' && /^https:\/\/[a-z0-9.-]*scdn\.co\/[\w./-]{1,200}$/i.test(m.artwork) ? m.artwork : null;
  return {
    app: m.app === 'spotify' ? 'spotify' : 'music',
    state, title, artist: clip(m.artist, 120), album: clip(m.album, 120),
    duration: secs(m.duration), position: secs(m.position), artwork: art,
  };
}

export function createMediaStore() {
  const players = new Map(); // host -> { host, label, ...media, at }
  const cmds = new Map();    // host -> [{ action, at }]

  const sig = (p) => p.app + '|' + p.state + '|' + p.title + '|' + p.artist;
  return {
    // true: ekrana yeniden yayinlamak gerekir (sarki/durum degisti ya da konum beklenenden fazla kaydi)
    update(host, label, raw, now = Date.now()) {
      const m = parseMedia(raw);
      const prev = players.get(host);
      if (!m) { if (prev) { players.delete(host); return true; } return false; }
      const next = { host, label: clip(label || host, 40), ...m, at: now, seen: now };
      players.set(host, next);
      if (!prev || sig(prev) !== sig(next)) return true;
      const expect = (prev.position || 0) + (prev.state === 'playing' ? (now - prev.at) / 1000 : 0);
      if (Math.abs((next.position || 0) - expect) > 3) return true;
      next.at = prev.at; next.position = prev.position; // sapma yok: eski olcumu koru (istemci kendi ilerletir)
      return false;
    },
    sweep(now = Date.now()) {
      let ch = false;
      for (const [h, p] of players) if (now - p.seen > STALE_MS) { players.delete(h); ch = true; }
      return ch;
    },
    // Konum: simdiki an icin (calarken olcumden bu yana gecen sure eklenir); istemci kendi saatinden ilerletir
    list(now = Date.now()) {
      return [...players.values()].sort((a, b) => (b.state === 'playing') - (a.state === 'playing')).map((p) => ({
        host: p.host, label: p.label, app: p.app, state: p.state, title: p.title, artist: p.artist, album: p.album,
        duration: p.duration, artwork: p.artwork,
        position: p.position === null ? null : Math.min(p.duration || Infinity, p.position + (p.state === 'playing' ? Math.max(0, now - p.at) / 1000 : 0)),
      }));
    },
    has(host) { return players.has(host); },
    firstHost() { const l = this.list(); return l.length ? l[0].host : null; },
    command(host, action, now = Date.now()) {
      if (!isAction(action) || !players.has(host)) return false;
      const q = (cmds.get(host) || []).filter((c) => now - c.at < CMD_TTL_MS);
      if (q.length >= 4) return false;
      q.push({ action, at: now });
      cmds.set(host, q);
      return true;
    },
    takeCommands(host, now = Date.now()) {
      const q = (cmds.get(host) || []).filter((c) => now - c.at < CMD_TTL_MS).map((c) => c.action);
      cmds.delete(host);
      return q;
    },
  };
}
