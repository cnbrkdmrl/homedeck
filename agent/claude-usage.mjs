// Claude kotasi: PhoneBox'in yontemi (MIT, github.com/ersinkoc/phonebox QuotaMonitor.cs'ten uyarlandi).
//   Claude Code'un OAuth token'i ile https://api.anthropic.com/api/oauth/usage uc noktasina sorar.
//
// DIKKAT (bilerek, acikca):
//  - Bu uc nokta BELGELENMEMIS; Anthropic degistirebilir. Token'i Claude Code disinda kullanmak kosullarda gri bir alan olabilir.
//  - macOS'ta token Keychain'de ("Claude Code-credentials"): ilk okumada sistem izin penceresi cikar.
//  - OPT-IN: agent.config.json'da "claudeUsage": "oauth" (ya da AGENT_CLAUDE_USAGE=oauth) olmadan HIC calismaz.
// Guvenlik tasarimi:
//  - Token yalnizca BELLEKTE tutulur; diske/gunluge yazilmaz, hub'a gitmez (hub'a yalnizca yuzdeler gider).
//  - Token ASLA yenilenmez (yenilemeyi Claude Code yapar; burada yenilemek onun oturumunu bozabilir).
//  - Spam yok: en fazla 5 dk'da bir istek; hata olursa uzun geri cekilme; Keychain reddi 6 saat.
//  - Hata metinlerinden token temizlenir.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const KEYCHAIN_SERVICE = 'Claude Code-credentials';
export const MIN_POLL_MS = 5 * 60 * 1000;
export const BACKOFF = { keychain: 6 * 3600e3, auth: 5 * 60e3, rate: 10 * 60e3, net: 2 * 60e3, other: 5 * 60e3, expired: 5 * 60e3, nocred: 10 * 60e3 };

function defaultRun(cmd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 1 << 20, windowsHide: true }, (err, out) => (err ? reject(err) : resolve(String(out))));
  });
}

function planLabel(sub, tier) {
  const s = { team: 'Team', max: 'Max', pro: 'Pro', enterprise: 'Enterprise' }[sub] || (typeof sub === 'string' ? sub : '');
  const m = typeof tier === 'string' ? tier.match(/max_(\d+x)/) : null;
  if (m) return s === 'Max' || s === '' ? 'Max ' + m[1] : s + ' · Max ' + m[1];
  return s || '';
}

// security -w, veri yazdirilamaz karakter iceriyorsa HEX olarak basabilir: JSON degilse ve hex ise coz.
export function decodeMaybeHex(text) {
  const t = String(text).trim();
  if (t.startsWith('{') || !/^[0-9a-fA-F]+$/.test(t) || t.length % 2 !== 0) return t;
  try { const d = Buffer.from(t, 'hex').toString('utf8'); return d.trimStart().startsWith('{') ? d : t; } catch (e) { return t; }
}

// Kimlik bilgisi JSON'undan YALNIZCA gerekenleri alir (refreshToken'a hic dokunmaz, saklamaz).
export function parseCredentials(text) {
  let j;
  try { j = JSON.parse(text); } catch (e) { return null; }
  const o = j && typeof j === 'object' ? j.claudeAiOauth : null;
  if (!o || typeof o.accessToken !== 'string' || !o.accessToken) return null;
  return { token: o.accessToken, expiresAt: typeof o.expiresAt === 'number' ? o.expiresAt : 0, plan: planLabel(o.subscriptionType, o.rateLimitTier) };
}

const iso = (s) => { const d = Date.parse(s); return Number.isFinite(d) ? d : null; };
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// Yanit: yeni bicim "limits" dizisi (kind: session | weekly_all | weekly_scoped) ya da eski five_hour / seven_day.
export function parseUsage(root) {
  const limits = [];
  if (root && Array.isArray(root.limits)) {
    for (const l of root.limits) {
      if (!l || typeof l !== 'object') continue;
      const pct = num(l.percent);
      if (pct === null) continue;
      const model = l.scope && l.scope.model && typeof l.scope.model.display_name === 'string' ? l.scope.model.display_name : null;
      let label = typeof l.kind === 'string' && l.kind ? l.kind : 'Limit', windowSec = null;
      if (l.kind === 'session') { label = '5 saat'; windowSec = 18000; }
      else if (l.kind === 'weekly_all') { label = 'Haftalık'; windowSec = 604800; }
      else if (l.kind === 'weekly_scoped') { label = 'Haftalık · ' + (model || 'model'); windowSec = 604800; }
      limits.push({ label, percent: pct, resetsAt: iso(l.resets_at), windowSec });
    }
  }
  if (!limits.length && root && typeof root === 'object') {
    for (const [key, label, windowSec] of [['five_hour', '5 saat', 18000], ['seven_day', 'Haftalık', 604800]]) {
      const o = root[key];
      if (o && typeof o === 'object' && num(o.utilization) !== null) limits.push({ label, percent: o.utilization, resetsAt: iso(o.resets_at), windowSec });
    }
  }
  let extra = null;
  const x = root && root.extra_usage;
  if (x && typeof x === 'object' && x.is_enabled === true) extra = 'Ekstra kullanım açık · ' + Math.round(num(x.utilization) || 0) + '%';
  return { limits, extra };
}

export function createClaudeUsageSource({
  platform = process.platform, home = os.homedir(), run = defaultRun, fetchFn = globalThis.fetch,
  now = () => Date.now(), log = () => {}, keychainTimeoutMs = 30000,
} = {}) {
  let cache = null;     // { token, expiresAt, plan }  YALNIZCA bellekte
  let last = null;      // son basarili saglayici
  let lastFetchAt = 0;
  let nextAttempt = 0;
  let rawKeys = [];
  const noted = new Set();
  const note = (key, msg) => { if (!noted.has(key)) { noted.add(key); log('[agent] Claude kotasi: ' + msg); } };
  const scrub = (s, token) => (token ? String(s).split(token).join('***') : String(s)); // hata metinlerinden token'i temizle

  async function readCredentialText() {
    const file = path.join(home, '.claude', '.credentials.json');
    try { if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8'); } catch (e) { /* dosya okunamadi: Keychain'e dus */ }
    if (platform === 'darwin') return decodeMaybeHex((await run('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'], keychainTimeoutMs)).trim());
    return null;
  }

  async function ensureCredentials(t) {
    // expiresAt bilinmiyorsa (0) gecerli say; 401 gelirse dusurulur
    if (cache && (!cache.expiresAt || cache.expiresAt - t > 60000)) return cache;
    const text = await readCredentialText();
    cache = text ? parseCredentials(text) : null;
    return cache;
  }

  async function poll() {
    const t = now();
    if (t < nextAttempt) return last;
    if (last && t - lastFetchAt < MIN_POLL_MS) return last; // 5 dk'dan sik sorma

    let cred;
    try { cred = await ensureCredentials(t); }
    catch (e) {
      if (e && e.code === 44) { // errSecItemNotFound: Keychain'de kayit yok (Claude Code'a giris yapilmamis)
        nextAttempt = t + BACKOFF.nocred;
        note('nocred', 'Keychain\'de "Claude Code-credentials" kaydi yok (Claude Code\'a giris yapilmamis olabilir).');
        return last;
      }
      nextAttempt = t + BACKOFF.keychain;
      note('keychain', 'kimlik bilgisine erisilemedi (Keychain izni verilmedi ya da zaman asimi). 6 saat sonra tekrar denenecek; hemen denemek icin agent\'i yeniden baslat.');
      return last;
    }
    if (!cred) { nextAttempt = t + BACKOFF.nocred; note('nocred', 'Claude Code kimlik bilgisi bulunamadi (giris yapilmamis olabilir).'); return last; }
    if (cred.expiresAt && cred.expiresAt <= t) {
      // Yenilemeyi Claude Code yapar; biz YENILEMEYIZ. Bekleyip yeniden okuruz.
      cache = null; nextAttempt = t + BACKOFF.expired;
      note('expired', 'token suresi dolmus; Claude Code yenileyince yeniden okunacak.');
      return last;
    }

    try {
      const res = await fetchFn(USAGE_URL, {
        headers: { Authorization: 'Bearer ' + cred.token, 'anthropic-beta': 'oauth-2025-04-20' },
        signal: AbortSignal.timeout(15000),
      });
      if (res.status === 401 || res.status === 403) { cache = null; nextAttempt = t + BACKOFF.auth; note('auth', 'sunucu token\'i reddetti (HTTP ' + res.status + '); Claude Code yenileyince yeniden denenecek.'); return last; }
      if (res.status === 429) {
        const ra = Number(res.headers && res.headers.get ? res.headers.get('retry-after') : 0);
        nextAttempt = t + (ra > 0 ? Math.min(ra * 1000, 3600e3) : BACKOFF.rate);
        note('rate', 'cok fazla istek (HTTP 429), bekleniyor.');
        return last;
      }
      if (!res.ok) { nextAttempt = t + BACKOFF.other; note('http' + res.status, 'beklenmeyen yanit (HTTP ' + res.status + ').'); return last; }
      const root = await res.json();
      rawKeys = root && typeof root === 'object' ? Object.keys(root).sort() : [];
      const { limits, extra } = parseUsage(root);
      if (!limits.length) { nextAttempt = t + BACKOFF.other; note('empty', 'yanit alindi ama taninan limit yok (yanit bicimi degismis olabilir).'); return last; }
      last = { id: 'claude', name: 'Claude', plan: cred.plan, extra, limits, observedAt: now() };
      lastFetchAt = t; nextAttempt = 0; noted.clear();
      return last;
    } catch (e) {
      nextAttempt = t + BACKOFF.net;
      note('net', 'istek basarisiz (' + scrub(e && e.message, cred.token) + ').');
      return last;
    }
  }

  return { poll, diag: () => ({ hasToken: !!cache, plan: cache ? cache.plan : null, expiresAt: cache ? cache.expiresAt : null, rawKeys, nextAttempt }) };
}

// Tani: kayitlarin YAPISINI gosterir (hangi anahtarlar var). Hicbir DEGER yazdirilmaz: token, e-posta, sunucu adi, URL yok.
export function structureOf(text, now = Date.now()) {
  const raw = String(text).trim();
  const info = { uzunluk: raw.length, hexMi: /^[0-9a-fA-F]+$/.test(raw) && !raw.startsWith('{') };
  const t = decodeMaybeHex(raw);
  if (t !== raw) info.hexten_cozuldu = true;
  let j;
  try { j = JSON.parse(t); } catch (e) { info.json = false; return info; }
  info.json = true;
  info.ustAnahtarlar = j && typeof j === 'object' ? Object.keys(j).sort() : [];
  const o = j && j.claudeAiOauth;
  if (o && typeof o === 'object') {
    info.claudeAiOauth = {
      anahtarlar: Object.keys(o).sort(),
      accessTokenVar: typeof o.accessToken === 'string' && o.accessToken.length > 0,
      refreshTokenVar: typeof o.refreshToken === 'string' && o.refreshToken.length > 0,
      sureDakika: typeof o.expiresAt === 'number' ? Math.round((o.expiresAt - now) / 60000) : null,
      abonelik: typeof o.subscriptionType === 'string' ? o.subscriptionType : null,
      kademe: typeof o.rateLimitTier === 'string' ? o.rateLimitTier : null,
    };
  } else info.claudeAiOauth = 'YOK';
  if (j && j.mcpOAuth && typeof j.mcpOAuth === 'object') info.mcpOAuthKayitSayisi = Object.keys(j.mcpOAuth).length;
  return info;
}

// --- Deneme komutu: node claude-usage.mjs --probe  (ilk Keychain iznini BILINCLI vermek ve zinciri dogrulamak icin) ---
const isMain = (() => { try { return process.argv[1] && pathToFileURL(fs.realpathSync(process.argv[1])).href === pathToFileURL(fs.realpathSync(fileURLToPath(import.meta.url))).href; } catch (e) { return false; } })();
if (isMain && process.argv.includes('--diagnose')) {
  console.log('Claude kimlik kayitlarinin YAPISI (hicbir deger yazdirilmaz).');
  if (process.platform !== 'darwin') { console.log('Bu komut macOS Keychain icin; baska platformda ~/.claude/.credentials.json dosyasina bak.'); process.exit(0); }
  const names = ['Claude Code-credentials'];
  try {
    const dump = await defaultRun('security', ['dump-keychain'], 60000);
    for (const m of dump.matchAll(/"svce"<blob>="(Claude Code-credentials[^"]*)"/g)) if (!names.includes(m[1])) names.push(m[1]);
  } catch (e) { console.log('(dump-keychain okunamadi, yalniz varsayilan ad denenecek)'); }
  console.log('Bulunan hizmet adlari:', names.join(' | '), '\n3 dakikaya kadar izin penceresi icin beklenir.\n');
  for (const name of names) {
    console.log('== ' + name);
    try {
      const text = await defaultRun('security', ['find-generic-password', '-s', name, '-w'], 180000);
      console.log(JSON.stringify(structureOf(text), null, 2).replace(/^/gm, '   '));
    } catch (e) { console.log('   okunamadi (kod ' + (e && e.code) + '): ' + (e && e.code === 44 ? 'kayit yok' : 'izin verilmedi ya da zaman asimi')); }
  }
  process.exit(0);
}
if (isMain && process.argv.includes('--probe')) {
  console.log('Claude kota denemesi (token EKRANA YAZILMAZ).');
  if (process.platform === 'darwin') console.log('macOS bir izin penceresi gosterebilir ("security ... Claude Code-credentials"). Parolani girip Izin Ver / Her Zaman Izin Ver\'den birini sec. 3 dakika bekliyorum.');
  const src = createClaudeUsageSource({ log: (m) => console.log(m), keychainTimeoutMs: 180000 });
  const r = await src.poll();
  const d = src.diag();
  if (!r) { console.log('\nSONUC: veri ALINAMADI. Nedeni yukaridaki satirda.'); process.exit(1); }
  console.log('\nplan        :', r.plan || '(bilinmiyor)');
  console.log('token omru  :', d.expiresAt ? Math.round((d.expiresAt - Date.now()) / 60000) + ' dk sonra doluyor' : 'bilinmiyor');
  console.log('yanit alanlari (yalniz adlar):', d.rawKeys.join(', '));
  for (const l of r.limits) console.log('  ' + l.label.padEnd(24), '%' + String(Math.round(l.percent * 10) / 10).padEnd(6), l.resetsAt ? '| sifirlanma: ' + Math.round((l.resetsAt - Date.now()) / 60000) + ' dk sonra' : '');
  if (r.extra) console.log('ekstra      :', r.extra);
  console.log('\nSONUC: BASARILI. Bu degerler Claude uygulamasindaki kullanim sayfasiyla uyusuyor mu, bir kontrol et.');
  process.exit(0);
}
