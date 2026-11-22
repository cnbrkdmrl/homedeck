// AI oturumlari (Claude Code kancalarindan gelen olaylar). Bellekte tutulur; hub yeniden baslarsa oturumlar
// sonraki olayla kendiliginden geri gelir.
const STATES = new Set(['working', 'waiting', 'idle', 'ended']);
const MAX_SESSIONS = 60;
const WORKING_STALE_MS = 15 * 60 * 1000; // 15 dk olay gelmeyen "calisiyor" oturum buyuk ihtimalle kapanmis: bosta say
const DROP_MS = 12 * 60 * 60 * 1000;     // 12 saat sessiz oturumu listeden dus

const clip = (v, n) => String(v === null || v === undefined ? '' : v).replace(/[\r\n\t]+/g, ' ').trim().slice(0, n);

export function createSessionStore() {
  const map = new Map();

  // true = liste degisti
  function update(host, b) {
    const sid = clip(b.session_id, 80);
    const state = clip(b.state, 10);
    if (!sid || !STATES.has(state)) return false;
    const key = host + ':' + sid;
    if (state === 'ended') return map.delete(key);
    const now = Date.now();
    let s = map.get(key);
    if (!s) {
      if (map.size >= MAX_SESSIONS) {
        let oldest = null;
        for (const v of map.values()) if (!oldest || v.lastSeen < oldest.lastSeen) oldest = v;
        if (oldest) map.delete(oldest.id);
      }
      s = { id: key, host, agent: 'claude', project: '', title: '', state: 'idle', since: now, lastSeen: now, tool: '', message: '' };
      map.set(key, s);
    }
    s.agent = clip(b.agent || s.agent, 12) || 'claude';
    s.project = clip(b.project, 40) || s.project;
    if (!s.title && b.title) s.title = clip(b.title, 60); // ilk istem, oturumu tanimak icin
    if (s.state !== state) { s.state = state; s.since = now; }
    s.lastSeen = now;
    s.tool = state === 'working' ? clip(b.tool, 24) : '';
    s.message = state === 'waiting' ? clip(b.message, 100) : '';
    return true;
  }

  function sweep() {
    const now = Date.now();
    let changed = false;
    for (const [k, s] of map) {
      if (now - s.lastSeen > DROP_MS) { map.delete(k); changed = true; continue; }
      if (s.state === 'working' && now - s.lastSeen > WORKING_STALE_MS) { s.state = 'idle'; s.since = now; s.tool = ''; changed = true; }
    }
    return changed;
  }

  function list() {
    return [...map.values()].map((s) => ({
      id: s.id, host: s.host, agent: s.agent, project: s.project, title: s.title,
      state: s.state, since: s.since, tool: s.tool, message: s.message,
    }));
  }

  return { update, sweep, list };
}
