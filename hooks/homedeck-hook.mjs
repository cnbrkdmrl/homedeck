#!/usr/bin/env node
// HomeDeck Claude Code kancasi: oturumun durumunu (calisiyor / bekliyor / bosta) hub'a bildirir.
//
// KURALLAR (Claude Code'u asla etkilememeli):
//  - stdout'a HICBIR sey yazmaz (bazi kancalarin stdout'u Claude'un baglamina eklenir).
//  - Her durumda cikis kodu 0 (hub kapali/yanlis token/ag hatasi Claude'u engellemez).
//  - En fazla ~1.5 sn bekler.
//
// Ayarlar: agent ile ayni dosya (agent.config.json: hub, token, host). HOMEDECK_CONFIG ile degistirilebilir.
// Ilk istem (oturum basligi) gonderilmesin istersen: HOMEDECK_TITLES=0
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DEADLINE_MS = 800;
const DEBOUNCE_MS = 4000; // sik arac cagrilarinda ayni durumu tekrar gonderme
const DOWN_MS = 60000;    // hub'a ulasilamazsa bu sure boyunca hic deneme (devre kesici)
const downFile = path.join(os.tmpdir(), 'homedeck-hook-down.json');

function isDown() {
  try { return Date.now() < JSON.parse(fs.readFileSync(downFile, 'utf8')).until; } catch (e) { return false; }
}
function trip() {
  try { fs.writeFileSync(downFile, JSON.stringify({ until: Date.now() + DOWN_MS })); } catch (e) { /* onemsiz */ }
}

function configPath() {
  if (process.env.HOMEDECK_CONFIG) return process.env.HOMEDECK_CONFIG;
  const win = process.platform === 'win32' ? 'C:\\HomeDeckAgent\\agent.config.json' : null;
  const unix = path.join(os.homedir(), '.homedeck-agent', 'agent.config.json');
  return win && fs.existsSync(win) ? win : unix;
}

function readStdin() {
  return new Promise((resolve) => {
    let buf = '';
    const t = setTimeout(() => resolve(buf), 800); // stdin kapanmazsa takilma
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { buf += c; if (buf.length > 2_000_000) buf = buf.slice(0, 2_000_000); });
    process.stdin.on('end', () => { clearTimeout(t); resolve(buf); });
    process.stdin.on('error', () => { clearTimeout(t); resolve(buf); });
  });
}

function mapEvent(j) {
  const ev = j.hook_event_name;
  switch (ev) {
    case 'SessionStart': return { state: 'idle' };
    case 'UserPromptSubmit': return { state: 'working' };
    case 'PostToolUse': return { state: 'working', tool: j.tool_name };
    case 'Stop': return { state: 'idle' };
    case 'SessionEnd': return { state: 'ended' };
    case 'Notification': {
      const type = String(j.notification_type || '');
      const msg = String(j.message || '');
      // izin istegi = kullanicidan onay bekliyor; "girdi bekliyor" = tur bitti, bosta
      if (type === 'permission_prompt' || /permission|approve|allow|izin/i.test(msg)) return { state: 'waiting', message: msg };
      return { state: 'idle' };
    }
    default: return null;
  }
}

async function main() {
  let j;
  // stdin HER ZAMAN once okunur (erken cikarsak Claude Code tarafinda kirik-boru hatasi olabilir)
  try { j = JSON.parse(await readStdin()); } catch (e) { return; }
  if (!j || !j.session_id) return;
  const m = mapEvent(j);

  let cfg = {};
  // BOM (﻿) temizle: Windows PowerShell 5.1 ile yazilan ayar dosyalarinda olur
  try { cfg = JSON.parse(fs.readFileSync(configPath(), 'utf8').replace(/^﻿/, '')); } catch (e) { /* config yok: asagida cikilir */ }

  // Hata ayiklama (agent.config.json'a "debug": true ya da HOMEDECK_DEBUG=1): gelen olayin YAPISINI kaydeder.
  // Yalnizca olay adi ve alan ADLARI yazilir; istem/yanit gibi icerik yazilmaz.
  if (process.env.HOMEDECK_DEBUG === '1' || cfg.debug === true) {
    try {
      fs.appendFileSync(path.join(os.tmpdir(), 'homedeck-hook-debug.log'), JSON.stringify({
        t: new Date().toISOString(), event: j.hook_event_name, fields: Object.keys(j).sort(),
        notification_type: j.notification_type || null, tool: j.tool_name || null, mapped: m ? m.state : '(yok sayildi)',
      }) + '\n');
    } catch (e) { /* onemsiz */ }
  }
  if (!m) return;
  if (isDown()) return; // hub'a ulasilamiyor: ag istegi atma (devre kesici)
  const hub = String(process.env.HOMEDECK_URL || cfg.hub || '').replace(/\/$/, '');
  const token = process.env.HOMEDECK_TOKEN || cfg.token || '';
  if (!hub || !token) return;

  // Yerel tekrar onleme (her arac cagrisi icin ag istegi atma)
  const safeId = String(j.session_id).replace(/[^\w-]/g, '').slice(0, 60);
  const cache = path.join(os.tmpdir(), 'homedeck-hook-' + safeId + '.json');
  let last = null;
  try { last = JSON.parse(fs.readFileSync(cache, 'utf8')); } catch (e) { /* ilk olay */ }
  const now = Date.now();
  if (j.hook_event_name === 'PostToolUse' && last && last.state === m.state && now - last.ts < DEBOUNCE_MS) return;
  try {
    if (m.state === 'ended') fs.rmSync(cache, { force: true });
    else fs.writeFileSync(cache, JSON.stringify({ state: m.state, ts: now }));
  } catch (e) { /* onemsiz */ }

  const body = {
    session_id: j.session_id,
    agent: 'claude',
    state: m.state,
    event: j.hook_event_name,
    project: String(j.cwd || '').split(/[\\/]/).filter(Boolean).pop() || '', // hem / hem \ ayiraci
    tool: m.tool || '',
    message: m.message || '',
  };
  if (j.hook_event_name === 'UserPromptSubmit' && process.env.HOMEDECK_TITLES !== '0' && typeof j.prompt === 'string') {
    body.title = j.prompt.split('\n').find((l) => l.trim()) || '';
  }

  try {
    const res = await fetch(hub + '/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(DEADLINE_MS),
    });
    if (res.status >= 500) trip(); // hub hasta: bir sure deneme
  } catch (e) {
    trip(); // hub kapali / ev agi disindayiz: DOWN_MS boyunca hic deneme (Claude'u yavaslatma)
  }
}

main().catch(() => {}).finally(() => process.exit(0));
