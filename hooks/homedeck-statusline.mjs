#!/usr/bin/env node
// HomeDeck statusLine betigi: Claude Code durum satirina verdigi JSON'dan 'rate_limits' (5 saatlik ve haftalik kota)
// alanini yerel bir dosyaya yazar. AG, TOKEN, KEYCHAIN YOK; yalnizca yerel dosya. Agent o dosyayi okuyup hub'a yollar.
//
// KURALLAR:
//  - stdout'a hicbir sey yazmaz (durum satiri bos kalir), her durumda cikis kodu 0, hizlidir (~50 ms).
//  - Yalnizca alan ADLARINI ve kota sayilarini yazar; istem/yanit/yol gibi icerik yazmaz.
//  - Hata ayiklama: claude-statusline-debug.json "cagrildi mi, rate_limits geldi mi" sorusunu yanitlar (masaustu uygulamasi
//    statusLine'i cagirmayabilir; bu dosya o durumu gosterir).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIR = process.env.HOMEDECK_DIR || (process.platform === 'win32' ? 'C:\\HomeDeckAgent' : path.join(os.homedir(), '.homedeck-agent'));
const OUT = path.join(DIR, 'claude-rate-limits.json');
const DEBUG = path.join(DIR, 'claude-statusline-debug.json');
const THROTTLE_MS = 30000;

function readStdin() {
  return new Promise((resolve) => {
    let buf = '';
    const t = setTimeout(() => resolve(buf), 800);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { buf += c; if (buf.length > 4_000_000) buf = buf.slice(0, 4_000_000); });
    process.stdin.on('end', () => { clearTimeout(t); resolve(buf); });
    process.stdin.on('error', () => { clearTimeout(t); resolve(buf); });
  });
}

// resets_at: epoch SANIYE (belgelendigi gibi); milisaniye ya da ISO metin gelirse de dogru okunur. Cikti: epoch milisaniye ya da null.
function toMs(v) {
  if (typeof v === 'number' && isFinite(v)) return v < 1e12 ? Math.round(v * 1000) : Math.round(v);
  if (typeof v === 'string' && v) { const d = Date.parse(v); return isFinite(d) ? d : null; }
  return null;
}
function pct(v) {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && isFinite(n) ? Math.max(0, Math.min(100, n)) : null;
}
function win(o) {
  if (!o || typeof o !== 'object') return null;
  const used = pct(o.used_percentage !== undefined ? o.used_percentage : o.utilization);
  if (used === null) return null;
  return { used, resetsAt: toMs(o.resets_at !== undefined ? o.resets_at : o.reset_at) };
}

function atomicWrite(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; } }

async function main() {
  let j;
  try { j = JSON.parse(await readStdin()); } catch (e) { return; }
  if (!j || typeof j !== 'object') return;
  const now = Date.now();
  const rl = j.rate_limits && typeof j.rate_limits === 'object' ? j.rate_limits : null;

  // Hata ayiklama dosyasi: en fazla 30 sn'de bir
  const prevDbg = readJson(DEBUG);
  if (!prevDbg || now - (prevDbg.lastCalledAt || 0) > THROTTLE_MS || prevDbg.hasRateLimits !== !!rl) {
    try {
      atomicWrite(DEBUG, JSON.stringify({
        lastCalledAt: now, hasRateLimits: !!rl, fields: Object.keys(j).sort(), rateLimitKeys: rl ? Object.keys(rl).sort() : [],
        claudeVersion: typeof j.version === 'string' ? j.version : null,
      }, null, 1));
    } catch (e) { /* onemsiz */ }
  }
  if (!rl) return;

  const five = win(rl.five_hour), week = win(rl.seven_day);
  if (!five && !week) return;
  const next = { observedAt: now, five_hour: five, seven_day: week };

  // Degismediyse ve 60 sn'den yeni ise yeniden yazma (durum satiri cok sik cagrilir)
  const prev = readJson(OUT);
  if (prev && now - (prev.observedAt || 0) < 60000 &&
      JSON.stringify(prev.five_hour) === JSON.stringify(five) && JSON.stringify(prev.seven_day) === JSON.stringify(week)) return;
  try { atomicWrite(OUT, JSON.stringify(next)); } catch (e) { /* onemsiz */ }
}

main().catch(() => {}).finally(() => process.exit(0));
