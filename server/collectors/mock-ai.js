// GECICI: AI kotalari ve AI oturumlari icin simule veri. Faz 3'te Kota + Claude Code hook'lari ile degisecek.
const t0 = Date.now();

// DEMO_QUOTAS=1: yeni (gercek) kota bicimiyle ornek veri: taze Claude, yasli Antigravity, bayat Codex (pencereleri sifirlanmis)
function quotas() {
  const now = Date.now();
  const drift = Math.floor(((now - t0) / 60000) % 5);
  const H = 3600e3;
  return {
    providers: [
      { id: 'claude', name: 'Claude', plan: '', extra: null, observedAt: now - 2 * 60000, source: 'laptop', limits: [
        { label: '5 saat', percent: 13 + drift, resetsAt: now + 3.9 * H, windowSec: 18000 },
        { label: 'Haftalık', percent: 82, resetsAt: now + 4.2 * 24 * H, windowSec: 604800 },
      ] },
      { id: 'antigravity', name: 'Antigravity', plan: 'Pro', extra: null, observedAt: now - 40 * 60000, source: 'laptop', limits: [
        { label: 'Oturum', percent: 35, resetsAt: now + 1.6 * H, windowSec: 18000 },
        { label: 'Haftalık', percent: 12, resetsAt: now + 5.1 * 24 * H, windowSec: 604800 },
      ] },
      { id: 'codex', name: 'Codex', plan: '', extra: null, observedAt: now - 3 * 24 * H, source: 'laptop', limits: [
        { label: '5 saat', percent: 71, resetsAt: now - 2.9 * 24 * H, windowSec: 18000 },
        { label: 'Haftalık', percent: 11, resetsAt: now - 1 * H, windowSec: 604800 },
      ] },
    ],
  };
}

function sessions() {
  const now = Date.now();
  const mk = (project, agent, state, minAgo, extra) => ({ project, agent, state, host: 'laptop', title: '', tool: '', message: '', since: now - minAgo * 60000, ...extra });
  return {
    sessions: [
      mk('homedeck', 'claude', 'working', 12, { tool: 'Edit', title: 'kancalari yaz' }),
      mk('demo-app', 'claude', 'working', 34, { host: 'desktop', tool: 'Bash', title: 'ornek gorev' }),
      mk('demo-app', 'claude', 'waiting', 95, { message: 'Claude needs your permission to use Bash', title: 'ornek gorev 2' }),
      mk('blog-site', 'claude', 'idle', 180, { title: 'yazi taslagi' }),
      mk('demo-lib', 'codex', 'idle', 260, { host: 'server' }),
    ],
  };
}

export const mockQuotas = {
  name: 'quotas',
  interval: 30000,
  async run() {
    return { data: quotas(), simulated: true };
  },
};

export const mockSessions = {
  name: 'sessions',
  interval: 10000,
  async run() {
    return { data: sessions(), simulated: true };
  },
};
