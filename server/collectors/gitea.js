// Gitea paneli (YALNIZ OKUMA): secili depolarin son commit'leri ve CI durumu.
// GITEA_TOKEN (okuma yetkili) yoksa kayit edilmez. GITEA_URL (ornek http://gitea.local:3000) ve GITEA_REPOS="sahip/depo,sahip/depo2" gerekir.
// Bir depoya token'in yetkisi yoksa yalniz o depo hata gosterir, digerleri calisir.
const BASE = (process.env.GITEA_URL || '').replace(/\/$/, '');
const TOKEN = process.env.GITEA_TOKEN || '';
const REPOS = (process.env.GITEA_REPOS || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 4);

const clip = (s, n) => String(s === null || s === undefined ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);

// Gitea birlesik durumunu sadelestir: success | failure | pending | none
export function ciState(s) {
  if (s === 'success') return 'success';
  if (s === 'failure' || s === 'error') return 'failure';
  if (s === 'pending' || s === 'running' || s === 'warning') return 'pending';
  return 'none';
}

// /commits cevabi -> ekran verisi (saf fonksiyon, test edilir)
export function normalizeCommits(list) {
  return (Array.isArray(list) ? list : []).slice(0, 5).map((c) => {
    const cm = (c && c.commit) || {};
    return {
      sha: clip(c && c.sha, 7),
      msg: clip(String(cm.message || '').split('\n')[0], 80),
      author: clip((cm.author && cm.author.name) || '', 24),
      ts: Date.parse((cm.author && cm.author.date) || (c && c.created)) || 0,
    };
  });
}

async function api(p) {
  const res = await fetch(BASE + '/api/v1' + p, { headers: { Authorization: 'token ' + TOKEN }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error('http ' + res.status);
  return res.json();
}

async function repo(name) {
  try {
    const [commits, status] = await Promise.all([
      api('/repos/' + name + '/commits?limit=5&stat=false&verification=false&files=false'),
      api('/repos/' + name + '/commits/HEAD/status').catch(() => null),
    ]);
    return { name, short: name.split('/').pop(), commits: normalizeCommits(commits), ci: ciState(status && status.state), error: null };
  } catch (e) {
    return { name, short: name.split('/').pop(), commits: [], ci: 'none', error: String(e.message || e) };
  }
}

export default {
  name: 'gitea',
  interval: 2 * 60 * 1000,
  async run() {
    if (!TOKEN) throw new Error('GITEA_TOKEN tanımlı değil');
    return { data: { repos: await Promise.all(REPOS.map(repo)) }, simulated: false };
  },
};
