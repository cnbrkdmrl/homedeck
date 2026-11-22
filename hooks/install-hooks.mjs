#!/usr/bin/env node
// HomeDeck Claude Code kancalarini kurar / kaldirir (kullanici duzeyi ayar: ~/.claude/settings.json).
//
// Kullanim:
//   node install-hooks.mjs --dry-run       ne yapacagini goster, HICBIR SEY yazma
//   node install-hooks.mjs                 kur (once yedek alir)
//   node install-hooks.mjs --uninstall     kaldir (yalnizca HomeDeck satirlarini; digerlerine dokunmaz)
// Secenekler: --settings <dosya> (varsayilan ~/.claude/settings.json), --dir <agent klasoru>
//
// Guvenlik: dosya bozuksa hicbir sey degistirmez; baska kancalara/ayarlara dokunmaz; yazmadan once yedekler;
// tekrar calistirmak guvenlidir (HomeDeck satirlari once temizlenir, sonra eklenir).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

const dryRun = flag('--dry-run');
const uninstall = flag('--uninstall');
const settingsFile = opt('--settings', path.join(os.homedir(), '.claude', 'settings.json'));
const agentDir = opt('--dir', process.platform === 'win32' ? 'C:\\HomeDeckAgent' : path.join(os.homedir(), '.homedeck-agent'));
const hookSrc = path.join(path.dirname(fileURLToPath(import.meta.url)), 'homedeck-hook.mjs');
const hookDest = path.join(agentDir, 'homedeck-hook.mjs');
const MARK = 'homedeck-hook.mjs';
const command = 'node "' + hookDest + '"';

// Olay -> grup. Arac olaylari icin matcher gerekir.
const EVENTS = {
  SessionStart: {},
  UserPromptSubmit: {},
  PostToolUse: { matcher: '*' },
  Notification: {},
  Stop: {},
  SessionEnd: {},
};

function fail(msg) { console.error('HATA: ' + msg); process.exit(1); }
function log(msg) { console.log(msg); }

// 1) Mevcut ayarlari oku (bozuksa dur)
let raw = null;
let settings = {};
if (fs.existsSync(settingsFile)) {
  raw = fs.readFileSync(settingsFile, 'utf8');
  if (raw.trim()) {
    try { settings = JSON.parse(raw); } catch (e) { fail(settingsFile + ' gecerli JSON degil; dokunmadim. Once onu duzelt.'); }
  }
  if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) fail(settingsFile + ' beklenen bicimde degil; dokunmadim.');
}
if (settings.hooks !== undefined && (typeof settings.hooks !== 'object' || settings.hooks === null || Array.isArray(settings.hooks))) {
  fail('"hooks" alani beklenen bicimde degil; dokunmadim.');
}

// 2) Onceki HomeDeck satirlarini temizle
let removed = 0;
const hooks = settings.hooks || {};
for (const ev of Object.keys(hooks)) {
  if (!Array.isArray(hooks[ev])) continue;
  hooks[ev] = hooks[ev]
    .map((g) => {
      if (!g || !Array.isArray(g.hooks)) return g;
      const keep = g.hooks.filter((h) => !(h && typeof h.command === 'string' && h.command.includes(MARK)));
      removed += g.hooks.length - keep.length;
      return keep.length ? { ...g, hooks: keep } : null;
    })
    .filter(Boolean);
  if (!hooks[ev].length) delete hooks[ev];
}

// 3) Ekle
let added = 0;
if (!uninstall) {
  for (const [ev, extra] of Object.entries(EVENTS)) {
    hooks[ev] = hooks[ev] || [];
    hooks[ev].push({ ...extra, hooks: [{ type: 'command', command }] });
    added++;
  }
}
if (Object.keys(hooks).length) settings.hooks = hooks;
else delete settings.hooks;

const out = JSON.stringify(settings, null, 2) + '\n';

// 4) Ozet
log((dryRun ? '[DRY-RUN] ' : '') + (uninstall ? 'KALDIRMA' : 'KURULUM') + ' -> ' + settingsFile);
log('  kanca betigi : ' + hookDest);
log('  onceki HomeDeck satiri temizlenen: ' + removed + (uninstall ? '' : ', eklenen: ' + added + ' olay (' + Object.keys(EVENTS).join(', ') + ')'));
const cfg = path.join(agentDir, 'agent.config.json');
if (!uninstall && !fs.existsSync(cfg)) log('  UYARI: ' + cfg + ' yok. Kanca hub adresini/token\'i oradan okur: once agent\'i kur (install-macos.sh / install-windows.ps1).');

if (dryRun) {
  log('\nYazilacak "hooks" bolumu:\n' + JSON.stringify(settings.hooks || {}, null, 2));
  log('\nDry-run: hicbir dosya degistirilmedi.');
  process.exit(0);
}

// 5) Yaz (once yedek)
try {
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  if (raw !== null) {
    const bak = settingsFile + '.homedeck-backup-' + new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(settingsFile, bak);
    log('  yedek        : ' + bak);
  }
  if (uninstall) {
    fs.rmSync(hookDest, { force: true });
  } else {
    fs.mkdirSync(agentDir, { recursive: true });
    fs.copyFileSync(hookSrc, hookDest);
  }
  const tmp = settingsFile + '.homedeck-tmp';
  fs.writeFileSync(tmp, out);
  fs.renameSync(tmp, settingsFile);
} catch (e) {
  fail('yazilamadi: ' + e.message);
}
log(uninstall ? '\nKaldirildi. Acik Claude Code oturumlari yeniden baslayana kadar eski ayarlarla devam eder.'
              : '\nKuruldu. ONEMLI: acik Claude Code oturumlarini kapatip yeniden ac (kancalar oturum baslarken okunur).');
