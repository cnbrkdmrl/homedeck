#!/usr/bin/env node
// HomeDeck statusLine betigini Claude Code ayarina kurar / kaldirir (~/.claude/settings.json icindeki "statusLine").
//
// Kullanim:
//   node install-statusline.mjs --dry-run     ne yapacagini goster, HICBIR SEY yazma
//   node install-statusline.mjs               kur (once yedek alir)
//   node install-statusline.mjs --uninstall   kaldir (yalnizca HomeDeck'in statusLine'ini; baskasininkine dokunmaz)
// Secenekler: --settings <dosya>, --dir <agent klasoru>
//
// Guvenlik: "statusLine" TEK bir komuttur. Zaten baska bir statusLine tanimliysa UZERINE YAZMAZ, durur ve nedenini soyler.
// Bozuk ayar dosyasina dokunmaz; yazmadan once yedekler; tekrar calistirmak guvenlidir.
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
const src = path.join(path.dirname(fileURLToPath(import.meta.url)), 'homedeck-statusline.mjs');
const dest = path.join(agentDir, 'homedeck-statusline.mjs');
const MARK = 'homedeck-statusline.mjs';
const command = 'node "' + dest + '"';

const fail = (m) => { console.error('HATA: ' + m); process.exit(1); };
const log = (m) => console.log(m);

let raw = null;
let settings = {};
if (fs.existsSync(settingsFile)) {
  raw = fs.readFileSync(settingsFile, 'utf8');
  if (raw.trim()) {
    try { settings = JSON.parse(raw); } catch (e) { fail(settingsFile + ' gecerli JSON degil; dokunmadim. Once onu duzelt.'); }
  }
  if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) fail(settingsFile + ' beklenen bicimde degil; dokunmadim.');
}

const cur = settings.statusLine;
const curCmd = cur && typeof cur === 'object' ? String(cur.command || '') : '';
const isOurs = curCmd.includes(MARK);

if (cur && !isOurs) {
  if (uninstall) { log('statusLine HomeDeck\'e ait degil; kaldirilacak bir sey yok, dokunmadim.'); process.exit(0); }
  fail('Zaten baska bir statusLine tanimli (' + JSON.stringify(cur).slice(0, 120) + '). statusLine tek bir komuttur, uzerine yazmadim. ' +
    'Bunu birlikte cozelim (komutlari birlestiren bir sarmalayici yazilabilir).');
}

if (uninstall) delete settings.statusLine;
else settings.statusLine = { type: 'command', command, padding: 0 };

const out = JSON.stringify(settings, null, 2) + '\n';
log((dryRun ? '[DRY-RUN] ' : '') + (uninstall ? 'KALDIRMA' : 'KURULUM') + ' -> ' + settingsFile);
log('  betik : ' + dest);
log('  ' + (uninstall ? 'kaldirilacak statusLine: ' + (isOurs ? 'HomeDeck' : 'yok') : (isOurs ? 'mevcut HomeDeck statusLine yenilenecek' : 'yeni statusLine eklenecek')));

if (dryRun) {
  log('\nYazilacak "statusLine" bolumu:\n' + JSON.stringify(settings.statusLine || null, null, 2));
  log('\nDry-run: hicbir dosya degistirilmedi.');
  process.exit(0);
}

try {
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  if (raw !== null) {
    const bak = settingsFile + '.homedeck-backup-' + new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(settingsFile, bak);
    log('  yedek : ' + bak);
  }
  if (uninstall) fs.rmSync(dest, { force: true });
  else { fs.mkdirSync(agentDir, { recursive: true }); fs.copyFileSync(src, dest); }
  const tmp = settingsFile + '.homedeck-tmp';
  fs.writeFileSync(tmp, out);
  fs.renameSync(tmp, settingsFile);
} catch (e) {
  fail('yazilamadi: ' + e.message);
}
log(uninstall ? '\nKaldirildi. Acik Claude Code oturumlari yeniden baslayana kadar eski ayarla devam eder.'
              : '\nKuruldu. ONEMLI: YENI bir Claude Code oturumu ac (statusLine oturum baslarken okunur). Acik oturumlar etkilenmez.');
