#!/usr/bin/env node
// HomeDeck agent: bu makinenin CPU / RAM / tum diskler / ag hizi bilgisini hub'a gonderir.
// Tek dosya, bagimlilik yok (Node 18.15+). macOS, Linux ve Windows destekli.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import util from 'node:util';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
let cfg = {};
let cfgNote = '';
const CFG_FILE = process.env.AGENT_CONFIG || path.join(here, 'agent.config.json');
try {
  // Windows PowerShell 5.1 "Set-Content -Encoding UTF8" dosyanin basina gorunmez bir BOM (﻿) koyar; JSON.parse bunu reddeder.
  cfg = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8').replace(/^﻿/, ''));
} catch (e) {
  // Ayar dosyasi opsiyonel (env ile de verilebilir) ama SESSIZCE yutma: asagida, varsayilana dusuluyorsa acikca uyarilir.
  cfgNote = e.code === 'ENOENT' ? 'ayar dosyasi yok' : 'ayar dosyasi okunamadi (' + String(e.message).slice(0, 80) + ')';
}

const HUB = (process.env.HUB_URL || cfg.hub || 'http://localhost:8787').replace(/\/$/, '');
const TOKEN = process.env.AGENT_TOKEN || cfg.token || '';
const HOST = process.env.AGENT_HOST || cfg.host || os.hostname().split('.')[0].toLowerCase();
const LABEL = process.env.AGENT_LABEL || cfg.label || HOST;
const INTERVAL = Number(process.env.AGENT_INTERVAL || cfg.intervalSec || 3) * 1000;
const HOST_ROOT = (process.env.HOST_ROOT || cfg.hostRoot || '').replace(/\/$/, ''); // konteynerde: /host
const DISKS = cfg.disks || (process.env.AGENT_DISKS ? process.env.AGENT_DISKS.split(',') : null); // elle disk listesi (opsiyonel)
const P = process.platform;
let media = null; // macOS calan sarki (media-mac.mjs); opt-in: agent.config.json'da "media": true ya da AGENT_MEDIA=1
let extra = null; // ek metrikler (GPU, pil, surecler, USB): extra-metrics.mjs yuklenirse dolar

function run(cmd, args, timeout) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeout || 4000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (err, out) => resolve(err ? '' : String(out)));
  });
}

// ---------- CPU ----------
let prevCpu = null;
function cpuPct() {
  let idle = 0;
  let total = 0;
  for (const c of os.cpus()) {
    const t = c.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  let pct = null;
  if (prevCpu) {
    const dt = total - prevCpu.total;
    const di = idle - prevCpu.idle;
    pct = dt > 0 ? (1 - di / dt) * 100 : 0;
  }
  prevCpu = { idle, total };
  return pct;
}

// ---------- RAM ----------
async function memory() {
  const total = os.totalmem();
  if (P === 'linux') {
    try {
      const txt = fs.readFileSync('/proc/meminfo', 'utf8');
      const m = txt.match(/^MemAvailable:\s+(\d+)/m);
      const t = txt.match(/^MemTotal:\s+(\d+)/m);
      if (m && t) return { total: Number(t[1]) * 1024, used: (Number(t[1]) - Number(m[1])) * 1024 };
    } catch (e) { /* os.* ile devam */ }
  }
  if (P === 'darwin') {
    const out = await run('vm_stat', []);
    const ps = Number((out.match(/page size of (\d+) bytes/) || [])[1] || 16384);
    const get = (k) => Number((out.match(new RegExp('^' + k + ':\\s+(\\d+)', 'm')) || [])[1] || 0);
    const used = (get('Pages active') + get('Pages wired down') + get('Pages occupied by compressor')) * ps;
    if (used > 0) return { total, used: Math.min(used, total) };
  }
  return { total, used: total - os.freemem() }; // Windows: freemem = kullanilabilir RAM
}

// ---------- Diskler ----------
function statDisk(p, name) {
  try {
    const s = fs.statfsSync(p);
    const used = (s.blocks - s.bfree) * s.bsize;
    const total = used + s.bavail * s.bsize; // df ile ayni "doluluk" mantigi
    if (!(total > 0)) return null;
    return { name: name, mount: name, total: total, used: used };
  } catch (e) {
    return null;
  }
}

const FS_REAL = /^(ext[234]|xfs|btrfs|zfs|f2fs|ntfs3?|fuseblk|vfat|exfat|apfs|hfs|reiserfs|jfs)$/;
const SKIP_PATH = /^\/(proc|sys|dev|run|snap|boot)(\/|$)|\/(docker|containers|kubelet|snapd)\/|\/\.|\/var\/lib\/(docker|kubelet)/;

function linuxDiskList() {
  const seen = new Set();
  const list = [];
  let txt = '';
  try { txt = fs.readFileSync('/proc/self/mounts', 'utf8'); } catch (e) { return list; }
  for (const line of txt.split('\n')) {
    const f = line.split(' ');
    if (f.length < 3) continue;
    const dev = f[0];
    const mp = f[1].replace(/\\040/g, ' ');
    const type = f[2];
    if (!FS_REAL.test(type)) continue;
    let shown = mp;
    if (HOST_ROOT) {
      if (mp !== HOST_ROOT && !mp.startsWith(HOST_ROOT + '/')) continue;
      shown = mp.slice(HOST_ROOT.length) || '/';
    }
    if (SKIP_PATH.test(shown)) continue;
    if (seen.has(dev)) continue; // bind mount tekrarlari
    seen.add(dev);
    const d = statDisk(mp, shown);
    if (d) { d.dev = dev; list.push(d); }
  }
  return list;
}

async function macDiskList() {
  const out = await run('df', ['-kP']);
  const list = [];
  const seen = new Set();
  for (const line of out.split('\n').slice(1)) {
    const f = line.trim().split(/\s+/);
    if (f.length < 6 || !f[0].startsWith('/dev/disk')) continue;
    const mount = f.slice(5).join(' ');
    let name = null;
    if (mount === '/System/Volumes/Data') name = 'Macintosh HD';
    else if (mount.startsWith('/Volumes/') && !/TimeMachine|Recovery|Preboot|Update|VM$/.test(mount)) name = mount.slice('/Volumes/'.length);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const used = Number(f[2]) * 1024;
    const total = used + Number(f[3]) * 1024;
    if (total > 0) list.push({ name: name, mount: mount, total: total, used: used });
  }
  return list;
}

function winDiskList() {
  const list = [];
  for (let c = 67; c <= 90; c++) { // C..Z
    const letter = String.fromCharCode(c) + ':';
    const d = statDisk(letter + '\\', letter);
    if (d) list.push(d);
  }
  return list;
}

let lastMacUsbCheck = 0;
async function disks() {
  let list = [];
  if (DISKS) list = DISKS.map((x) => (typeof x === 'string' ? statDisk(x, x) : statDisk(x.path, x.name || x.path))).filter(Boolean);
  else if (P === 'linux') list = linuxDiskList();
  else if (P === 'darwin') list = await macDiskList();
  else if (P === 'win32') list = winDiskList();
  if (extra) {
    try {
      // macOS: harici mi sorusu diskutil ile (yavas) sorulur; dakikada bir arka planda tazele
      if (P === 'darwin' && Date.now() - lastMacUsbCheck > 60000) {
        lastMacUsbCheck = Date.now();
        extra.refreshMacUsb(list.map((d) => d.mount)).catch(() => {});
      }
      for (const d of list) d.usb = extra.isUsb(d);
    } catch (e) { /* USB bilgisi olmadan devam */ }
  }
  return list;
}

// ---------- Ag ----------
let prevNet = null;
async function netCounters() {
  let rx = 0;
  let tx = 0;
  if (P === 'linux') {
    const lines = fs.readFileSync('/proc/net/dev', 'utf8').split('\n').slice(2);
    for (const line of lines) {
      const m = line.trim().match(/^([^:]+):\s*(.*)$/);
      if (!m || /^(lo|docker|veth|br-|virbr|tailscale|zt|cni|flannel)/.test(m[1])) continue;
      const f = m[2].split(/\s+/).map(Number);
      rx += f[0];
      tx += f[8];
    }
  } else if (P === 'darwin') {
    const out = await run('netstat', ['-ib']);
    const seen = new Set();
    for (const line of out.split('\n').slice(1)) {
      const f = line.trim().split(/\s+/);
      if (f.length < 10 || !/^en\d+$/.test(f[0]) || !f[2].startsWith('<Link#') || seen.has(f[0])) continue;
      seen.add(f[0]);
      rx += Number(f[f.length - 5]);
      tx += Number(f[f.length - 2]);
    }
  } else if (P === 'win32') {
    const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Get-NetAdapterStatistics | Select-Object Name,ReceivedBytes,SentBytes | ConvertTo-Json -Compress'], 8000);
    try {
      let arr = JSON.parse(out);
      if (!Array.isArray(arr)) arr = [arr];
      for (const a of arr) {
        if (/vEthernet|Loopback|VirtualBox|VMware|Bluetooth|WSL|Hyper-V/i.test(a.Name)) continue;
        rx += Number(a.ReceivedBytes) || 0;
        tx += Number(a.SentBytes) || 0;
      }
    } catch (e) { return null; }
  }
  return { rx: rx, tx: tx, t: Date.now() };
}

async function netRates() {
  const cur = await netCounters();
  if (!cur) return { rx: null, tx: null, failed: true }; // sayaclar okunamadi (ilk olcumden farkli: o 'failed' degil)
  let out = { rx: null, tx: null };
  if (prevNet) {
    const dt = (cur.t - prevNet.t) / 1000;
    if (dt > 0) {
      out = {
        rx: Math.max(0, ((cur.rx - prevNet.rx) * 8) / 1e6 / dt), // Mbit/s
        tx: Math.max(0, ((cur.tx - prevNet.tx) * 8) / 1e6 / dt),
      };
    }
  }
  prevNet = cur;
  return out;
}

// Islemci sicakligi (Linux): once hwmon (coretemp/k10temp...), sonra thermal_zone. Diskler (nvme/drivetemp) sayilmaz.
// Container'da host'un /sys'i HOST_ROOT altindadir (/host/sys); once oraya, sonra /sys'e bakilir.
const CPU_CHIPS = ['coretemp', 'k10temp', 'zenpower', 'cpu_thermal', 'soc_thermal', 'cpu-thermal', 'x86_pkg_temp'];
function readMilliC(f) {
  try { const n = Number(fs.readFileSync(f, 'utf8').trim()) / 1000; return n > 1 && n < 130 ? n : null; } catch (e) { return null; }
}
function readTxt(f) { try { return fs.readFileSync(f, 'utf8').trim(); } catch (e) { return null; } }
function lsDir(d) { try { return fs.readdirSync(d); } catch (e) { return []; } }
function temperature() {
  if (P !== 'linux') return null;
  const roots = [(process.env.HOST_ROOT || '') + '/sys', '/sys'];
  for (const root of roots) {
    const cpu = [], other = [];
    for (const d of lsDir(root + '/class/hwmon')) {
      const dir = root + '/class/hwmon/' + d, name = readTxt(dir + '/name') || d;
      if (/^(nvme|drivetemp|sd|hdd|ssd)/i.test(name)) continue;
      const vals = lsDir(dir).filter((f) => /^temp\d+_input$/.test(f)).map((f) => readMilliC(dir + '/' + f)).filter((v) => v !== null);
      if (vals.length) (CPU_CHIPS.includes(name) ? cpu : other).push(Math.max(...vals));
    }
    for (const d of lsDir(root + '/class/thermal').filter((n) => n.startsWith('thermal_zone'))) {
      const dir = root + '/class/thermal/' + d, type = readTxt(dir + '/type') || d;
      if (/^(nvme|drivetemp|sd|hdd|ssd)/i.test(type)) continue;
      const v = readMilliC(dir + '/temp');
      if (v !== null) (CPU_CHIPS.includes(type) ? cpu : other).push(v);
    }
    const pick = cpu.length ? cpu : other;
    if (pick.length) return Math.max(...pick);
  }
  return null;
}

// ---------- Dongu ----------
let lastOk = null;
let netWarned = false;
async function tick() {
  try {
    const cpu = cpuPct();
    const net = await netRates();
    if (cpu === null) return; // ilk CPU olcumu: delta yok
    let rx = net.rx;
    let tx = net.tx;
    if (net.failed) {
      // Ag sayaclari okunamiyor: CPU/RAM/disk yine gonderilsin, ag 0 olsun (eskiden hic bir sey gonderilmiyordu ve sessizdi)
      if (!netWarned) console.warn('[agent] UYARI: ag sayaclari okunamadi; ag degerleri 0 gonderiliyor');
      netWarned = true;
      rx = 0;
      tx = 0;
    } else {
      netWarned = false;
      if (rx === null) return; // ilk ag olcumu: delta yok
    }
    const payload = {
      host: HOST,
      label: LABEL,
      os: P === 'darwin' ? 'macOS' : P === 'win32' ? 'Windows' : 'Linux',
      cores: os.cpus().length,
      cpu: cpu,
      mem: await memory(),
      disks: await disks(),
      rx: rx,
      tx: tx,
      uptime: os.uptime(),
      temp: temperature(),
      extra: extra ? extra.snapshot() : null,
      media: media ? await media.read().catch(() => null) : null,
    };
    const res = await fetch(HUB + '/api/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error('hub http ' + res.status);
    if (res.status === 200 && media) {
      // Hub cevabinda ekrandan gelen medya komutlari olabilir: uygula, sonra durumu hemen yenile
      const j = await res.json().catch(() => null);
      const cmds = j && Array.isArray(j.commands) ? j.commands.slice(0, 4) : [];
      let did = false;
      for (const c of cmds) did = (await media.control(c)) || did;
      if (did) setTimeout(tick, 600);
    }
    if (lastOk !== true) console.log('[agent] hub baglantisi tamam (' + HOST + ' -> ' + HUB + ')');
    lastOk = true;
  } catch (err) {
    if (lastOk !== false) console.warn('[agent] gonderilemedi:', err.message);
    lastOk = false;
  }
}

// ---- Gunluk dosyasi ve yasam dongusu kaydi ----
// Pencere/konsol olmadan (gizli gorev) calisirken ciktiyi gormenin tek yolu dosyadir. Windows gorevinde "logFile" ayarlanir.
const LOG_FILE = process.env.AGENT_LOG || cfg.logFile || '';
if (LOG_FILE) {
  try { if (fs.statSync(LOG_FILE).size > 512 * 1024) fs.renameSync(LOG_FILE, LOG_FILE + '.1'); } catch (e) { /* ilk calisma / dosya yok */ }
  for (const [name, level] of [['log', 'INFO'], ['warn', 'WARN'], ['error', 'ERR']]) {
    const orig = console[name].bind(console);
    console[name] = (...a) => {
      try { orig(...a); } catch (e) { /* konsol yoksa sorun degil */ }
      try { fs.appendFileSync(LOG_FILE, new Date().toISOString() + ' ' + level + ' ' + util.format(...a) + '\n'); } catch (e) { /* onemsiz */ }
    };
  }
}
// Neden oldugunu bilmeden olmesin: sinyal ve cikis kodunu kaydet (Windows'ta konsol kapaninca SIGHUP, Ctrl+C'de SIGINT gelir).
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
  try { process.on(sig, () => { console.warn('[agent] sinyal alindi: ' + sig + ', kapaniyor'); process.exit(0); }); } catch (e) { /* bu platformda yok */ }
}
process.on('exit', (code) => { console.log('[agent] cikis, kod=' + code); });
process.on('uncaughtException', (e) => { console.error('[agent] BEKLENMEYEN HATA: ' + (e && e.stack ? e.stack : e)); process.exit(1); });
process.on('unhandledRejection', (e) => { console.error('[agent] ISLENMEYEN RED: ' + (e && e.stack ? e.stack : e)); });

console.log('[agent] baslatildi: ' + HOST + ' (' + LABEL + '), hub ' + HUB + ', ' + INTERVAL / 1000 + ' sn');
// Ayar yoksa/okunamadiysa ve hub adresi baska yolla verilmediyse varsayilana (localhost) dusuldu: bunu acikca soyle.
if (cfgNote && !process.env.HUB_URL && !cfg.hub) {
  console.warn('[agent] UYARI: ' + cfgNote + ' (' + CFG_FILE + '). Varsayilan hub (' + HUB + ') kullaniliyor; bu buyuk ihtimalle yanlis. Ayar dosyasini kontrol et.');
}
if (!TOKEN) console.warn('[agent] UYARI: token yok; hub verileri reddedecek (401).');
// Ek metrikler (opsiyonel): kapatmak icin agent.config.json'da "extraMetrics": false ya da AGENT_EXTRA=0. Modul yoksa/bozuksa sessizce atlanir.
if (process.env.AGENT_EXTRA !== '0' && cfg.extraMetrics !== false) {
  try {
    const em = await import('./extra-metrics.mjs');
    extra = em.createExtraMetrics({ platform: P, run: run, log: (m) => console.warn(m) });
    extra.start();
  } catch (e) { console.warn('[agent] extra-metrics.mjs yuklenemedi, ek metrikler kapali: ' + e.message); }
}
// Calan sarki (opsiyonel, yalniz macOS): Muzik ve Spotify uygulamalari. Ilk calismada macOS Otomasyon izni sorar.
if (process.env.AGENT_MEDIA === '1' || cfg.media === true) {
  try {
    const mm = await import('./media-mac.mjs');
    media = mm.createMedia({ platform: P, log: (m) => console.warn(m) });
    if (!media) console.warn('[agent] medya yalniz macOS destekli; kapali.');
  } catch (e) { console.warn('[agent] media-mac.mjs yuklenemedi, medya kapali: ' + e.message); }
}
(async function loop() {
  await tick();
  setTimeout(loop, INTERVAL);
})();

// ---- AI kotalari (opsiyonel): yerel dosyalardan okunur (Claude: statusLine dosyasi, Codex: oturum dosyalari), hub'a YALNIZCA yuzdeler gider ----
// Kapatmak icin: agent.config.json'da "quotas": false ya da AGENT_QUOTAS=0. Modul (quota-readers.mjs) yoksa kota raporlanmaz, agent calismaya devam eder.
let quotaMod = null;
if (process.env.AGENT_QUOTAS !== '0' && cfg.quotas !== false) {
  try { quotaMod = await import('./quota-readers.mjs'); } catch (e) { /* modul yok: kota raporlanmaz */ }
}
// Claude kotasi icin OPT-IN OAuth yontemi (PhoneBox gibi; Keychain + belgelenmemis uc nokta). Ayrintilar ve riskler: agent/claude-usage.mjs basi.
// Acmak icin agent.config.json'da "claudeUsage": "oauth" (ya da AGENT_CLAUDE_USAGE=oauth). VARSAYILAN KAPALI.
let claudeSrc = null;
if (process.env.AGENT_CLAUDE_USAGE === 'oauth' || cfg.claudeUsage === 'oauth') {
  try {
    const cm = await import('./claude-usage.mjs');
    claudeSrc = cm.createClaudeUsageSource({ log: (m) => console.warn(m) });
    console.log('[agent] Claude kotasi: OAuth yontemi ACIK');
  } catch (e) { console.warn('[agent] claude-usage.mjs yuklenemedi: ' + e.message); }
}
if (quotaMod || claudeSrc) {
  const QDIR = process.env.HOMEDECK_DIR || here;
  const QINTERVAL = Number(process.env.AGENT_QUOTA_INTERVAL || 60) * 1000;
  let qLastOk = null;
  (async function quotaLoop() {
    try {
      let providers = quotaMod ? quotaMod.collectQuotas({ dir: QDIR }) : [];
      if (quotaMod && quotaMod.readCodexQuotaZst && !providers.some((q) => q.id === 'codex')) { const cx = await quotaMod.readCodexQuotaZst(process.env.CODEX_HOME || path.join(os.homedir(), '.codex')); if (cx) providers.push(cx); }
      if (quotaMod && quotaMod.readAntigravityQuota) { const ag = await quotaMod.readAntigravityQuota(); if (ag) providers.push(ag); }
      if (claudeSrc) {
        // OAuth okumasi varsa ve dosyadakinden yeniyse onu kullan (daha taze ve daha zengin)
        const c = await claudeSrc.poll();
        const cur = providers.find((q) => q.id === 'claude');
        if (c && (!cur || c.observedAt >= cur.observedAt)) providers = providers.filter((q) => q.id !== 'claude').concat(c);
      }
      if (providers.length) {
        const res = await fetch(HUB + '/api/quota', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
          body: JSON.stringify({ providers: providers }),
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) throw new Error('hub http ' + res.status);
        if (qLastOk !== true) console.log('[agent] kota raporu gonderiliyor: ' + providers.map((q) => q.id).join(', '));
        qLastOk = true;
      }
    } catch (e) {
      if (qLastOk !== false) console.warn('[agent] kota gonderilemedi: ' + e.message);
      qLastOk = false;
    }
    setTimeout(quotaLoop, QINTERVAL);
  })();
}
