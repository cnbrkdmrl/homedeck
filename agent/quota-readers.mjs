// AI kota okuyuculari (agent icin). Hepsi YEREL ve SALT OKUNUR: ag yok, token yok, Keychain yok.
//  - Claude : statusLine betiginin yazdigi claude-rate-limits.json (hooks/homedeck-statusline.mjs)
//  - Codex  : ~/.codex/sessions altindaki en yeni rollout dosyalarindaki son "rate_limits" kaydi
//             (yontem PhoneBox'in QuotaMonitor.cs'inden uyarlanmistir, MIT lisansli: github.com/ersinkoc/phonebox)
// Cikti: hub'in /api/quota'sina gidecek saglayici listesi. Bayat (>8 gun) veri HIC dondurulmez (yaniltmasin).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import zlib from 'node:zlib';
import readline from 'node:readline';

export const MAX_AGE_MS = 8 * 24 * 3600 * 1000; // haftalik pencereden uzun: bundan eski veri anlamsiz

function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; } }
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function readClaudeQuota(dir, now = Date.now()) {
  const j = readJson(path.join(dir, 'claude-rate-limits.json'));
  if (!j || typeof j !== 'object') return null;
  const observedAt = num(j.observedAt);
  if (observedAt === null || now - observedAt > MAX_AGE_MS) return null;
  const limits = [];
  const add = (w, label, windowSec) => {
    if (w && typeof w === 'object' && num(w.used) !== null) limits.push({ label, percent: w.used, resetsAt: num(w.resetsAt), windowSec });
  };
  add(j.five_hour, '5 saat', 18000);
  add(j.seven_day, 'Haftalık', 604800);
  if (!limits.length) return null;
  return { id: 'claude', name: 'Claude', plan: '', extra: null, limits, observedAt };
}

// En yeni dosyalari bulur: yil/ay/gun klasorlerini AZALAN sirada gezer, 'count' dosya bulunca durur (binlerce dosyayi taramaz).
function newestRollouts(root, count) {
  const out = [];
  const walk = (dir) => {
    if (out.length >= count) return;
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    const dirs = ents.filter((e) => e.isDirectory()).map((e) => e.name).sort().reverse();
    const files = ents.filter((e) => e.isFile() && /^rollout-.*\.jsonl(\.zst)?$/.test(e.name)).map((e) => e.name).sort().reverse();
    for (const f of files) { if (out.length >= count) return; out.push(path.join(dir, f)); }
    for (const d of dirs) { if (out.length >= count) return; walk(path.join(dir, d)); }
  };
  walk(root);
  return out;
}

function lastRateLimits(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, 1 << 20); // son 1 MB
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    const lines = buf.toString('utf8').split('\n');
    // Okuma dosyanin ORTASINDAN basladiysa ilk satir yarim olabilir: atla. Baştan basladiysa (kucuk dosya) ilk satir eksiksizdir.
    const firstIsComplete = size - len === 0;
    for (let i = lines.length - 1; i >= (firstIsComplete ? 0 : 1); i--) {
      if (!lines[i].includes('"rate_limits"') || !lines[i].includes('"primary"')) continue;
      try {
        const j = JSON.parse(lines[i]);
        const rl = j && j.payload && j.payload.rate_limits;
        if (rl && typeof rl === 'object') return rl;
      } catch (e) { /* yarim/bozuk satir: bir oncekine bak */ }
    }
  } catch (e) { /* okunamadi */ } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch (e) { /* onemsiz */ } }
  return null;
}

function codexLabel(mins) {
  if (mins === 300) return '5 saat';
  if (mins === 10080) return 'Haftalık';
  if (mins >= 1440) return Math.floor(mins / 1440) + ' gün';
  if (mins > 0) return Math.floor(mins / 60) + ' saat';
  return 'Limit';
}

function codexFromLimits(rl, m) {
    const limits = [];
    for (const key of ['primary', 'secondary']) {
      const w = rl[key];
      if (!w || typeof w !== 'object') continue;
      const pct = num(w.used_percent);
      if (pct === null) continue;
      const mins = num(w.window_minutes) || 0;
      let resetsAt = null;
      if (num(w.resets_at) !== null) resetsAt = Math.round(w.resets_at * 1000);
      else if (num(w.resets_in_seconds) !== null) resetsAt = Math.round(m + w.resets_in_seconds * 1000);
      limits.push({ label: codexLabel(mins), percent: pct, resetsAt, windowSec: mins > 0 ? mins * 60 : null });
    }
    if (!limits.length) return null;
    let extra = null;
    const cr = rl.credits;
    if (cr && typeof cr === 'object') {
      if (cr.unlimited === true) extra = 'Kredi: sınırsız';
      else if (cr.has_credits === true && cr.balance !== null && cr.balance !== undefined && isFinite(Number(cr.balance))) extra = 'Kredi: ' + Math.round(Number(cr.balance)).toLocaleString('en-US');
    }
    if (limits.some((l) => l.percent >= 100)) extra = extra ? 'Limit doldu · ' + extra : 'Limit doldu';
    const pt = typeof rl.plan_type === 'string' && rl.plan_type ? rl.plan_type.charAt(0).toUpperCase() + rl.plan_type.slice(1) : '';
    return { id: 'codex', name: 'Codex', plan: pt, extra, limits, observedAt: Math.round(m) };
}

export function readCodexQuota(codexHome, now = Date.now()) {
  const root = path.join(codexHome, 'sessions');
  if (!fs.existsSync(root)) return null;
  const files = newestRollouts(root, 5)
    .filter((p) => !p.endsWith('.zst'))
    .map((p) => { try { return { p, m: fs.statSync(p).mtimeMs }; } catch (e) { return null; } })
    .filter(Boolean)
    .sort((a, b) => b.m - a.m);
  for (const f of files) {
    const rl = lastRateLimits(f.p);
    if (!rl) continue;
    if (now - f.m > MAX_AGE_MS) return null; // en yeni kayit bile bayat: gosterme
    const v = codexFromLimits(rl, f.m);
    if (!v) continue;
    return v;
  }
  return null;
}

// Agent'in cagiracagi tek giris noktasi.
export function collectQuotas({ dir, home = os.homedir(), now = Date.now() } = {}) {
  const out = [];
  try { const c = readClaudeQuota(dir, now); if (c) out.push(c); } catch (e) { /* bir okuyucu digerlerini bozmasin */ }
  try { const x = readCodexQuota(process.env.CODEX_HOME || path.join(home, '.codex'), now); if (x) out.push(x); } catch (e) { /* idem */ }
  return out;
}

// ---------- Antigravity (Gemini) ----------
// Antigravity acikken yerel language_server'i (127.0.0.1) modellerin kalan kota oranini verir. Yalniz YEREL, salt okunur "GetUserStatus":
// uygulamanin kendi CSRF jetonu surec argumanlarindan okunur, hicbir yere yazilmaz/yollanmaz; hub'a yalniz yuzdeler gider (e-posta/ad GITMEZ).
// Antigravity kapaliysa veri yoktur (null) ve son bilinen deger hub'da kalir. Belgesiz bir arayuzdur: degisirse okuyucu sessizce null doner.
const AG_WINDOW_SEC = 7 * 86400;
function agFamily(label) {
  const l = String(label || '');
  if (/^gemini.*flash/i.test(l)) return 'Gemini Flash';
  if (/^gemini.*pro/i.test(l)) return 'Gemini Pro';
  if (/^claude/i.test(l)) return 'Claude (Antigravity)';
  if (/^gpt/i.test(l)) return 'GPT-OSS (Antigravity)';
  return null;
}

// userStatus -> saglayici (saf fonksiyon, test edilir). Ayni aile modellerinden EN COK kullanilan gosterilir.
export function parseAntigravity(us, now = Date.now()) {
  const models = us && us.cascadeModelConfigData && Array.isArray(us.cascadeModelConfigData.clientModelConfigs) ? us.cascadeModelConfigData.clientModelConfigs : [];
  const fam = new Map();
  for (const m of models) {
    const q = m && m.quotaInfo, name = agFamily(m && m.label);
    if (!q || !name || num(q.remainingFraction) === null) continue;
    const used = Math.max(0, Math.min(100, (1 - q.remainingFraction) * 100));
    const t = q.resetTime ? Date.parse(q.resetTime) : NaN;
    const cur = fam.get(name);
    if (!cur || used > cur.percent) fam.set(name, { label: name, percent: Math.round(used * 10) / 10, resetsAt: Number.isFinite(t) ? t : null, windowSec: AG_WINDOW_SEC });
  }
  const limits = [...fam.values()];
  if (!limits.length) return null;
  const plan = us && us.planStatus && us.planStatus.planInfo && us.planStatus.planInfo.planName;
  return { id: 'antigravity', name: 'Gemini', plan: String(plan || '').slice(0, 24), extra: null, limits, observedAt: now };
}

const sh = (cmd, args) => new Promise((resolve) => execFile(cmd, args, { timeout: 5000, maxBuffer: 1 << 20 }, (e, out) => resolve(e ? '' : String(out))));
let agCache = { t: 0, v: null };
export async function readAntigravityQuota(now = Date.now()) {
  if (process.platform === 'win32') return null;
  if (now - agCache.t < 5 * 60000) return agCache.v;
  agCache = { t: now, v: null };
  try {
    const ps = await sh('ps', ['-axo', 'pid=,command=']);
    const line = ps.split('\n').find((l) => /bin\/language_server/.test(l) && /--csrf_token /.test(l));
    if (!line) return null;
    const pid = line.trim().split(/\s+/)[0], csrf = (/--csrf_token (\S+)/.exec(line) || [])[1];
    const ls = await sh('lsof', ['-nP', '-a', '-p', pid, '-iTCP', '-sTCP:LISTEN']);
    const ports = [...ls.matchAll(/127\.0\.0\.1:(\d+)/g)].map((m) => m[1]);
    for (const port of ports) {
      try {
        const res = await fetch('http://127.0.0.1:' + port + '/exa.language_server_pb.LanguageServerService/GetUserStatus', {
          method: 'POST', signal: AbortSignal.timeout(4000),
          headers: { 'Content-Type': 'application/json', 'Connect-Protocol-Version': '1', 'X-Codeium-Csrf-Token': csrf },
          body: JSON.stringify({ metadata: { ideName: 'antigravity', extensionName: 'antigravity', locale: 'en' } }),
        });
        if (!res.ok) continue;
        const v = parseAntigravity((await res.json()).userStatus, now);
        if (v) { agCache.v = v; return v; }
      } catch (e) { /* bu port degil: siradaki */ }
    }
  } catch (e) { /* sessiz */ }
  return null;
}

// ---------- Codex: yeni surumler oturum kayitlarini zstd ile sikistirir (rollout-*.jsonl.zst) ----------
// Dosya akis olarak acilir (tamami belleğe alinmaz), yalniz son "rate_limits" satiri tutulur. Sonuc dosya+degisim zamanina gore onbelleklenir.
// Node 22.15+/23.8+ gerekir (zlib zstd); yoksa sessizce null doner.
let czCache = { key: '', v: null };
export async function readCodexQuotaZst(codexHome, now = Date.now()) {
  if (typeof zlib.createZstdDecompress !== 'function') return null;
  const root = path.join(codexHome, 'sessions');
  if (!fs.existsSync(root)) return null;
  const f = newestRollouts(root, 3).filter((p) => p.endsWith('.zst'))
    .map((p) => { try { return { p, m: fs.statSync(p).mtimeMs }; } catch (e) { return null; } }).filter(Boolean).sort((a, b) => b.m - a.m)[0];
  if (!f || now - f.m > MAX_AGE_MS) return null;
  const key = f.p + '|' + f.m;
  if (czCache.key === key) return czCache.v;
  let last = null;
  try {
    const rl = readline.createInterface({ input: fs.createReadStream(f.p).pipe(zlib.createZstdDecompress()), crlfDelay: Infinity });
    for await (const line of rl) { if (line.includes('"rate_limits"') && line.includes('"primary"')) last = line; }
  } catch (e) { /* bozuk/yarim yazilmis dosya: eldekiyle yetin */ }
  let v = null;
  if (last) { try { const j = JSON.parse(last); const r = j && j.payload && j.payload.rate_limits; if (r && typeof r === 'object') v = codexFromLimits(r, f.m); } catch (e) { /* bozuk satir */ } }
  czCache = { key, v };
  return v;
}
