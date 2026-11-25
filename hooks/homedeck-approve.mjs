#!/usr/bin/env node
// HomeDeck Claude Code "PermissionRequest" kancası: izin penceresini iPad'e de gösterir; oradan "İzin ver" /
// "Reddet" denirse Claude Code'a o kararı iletir. OPT-IN: yalnızca `install-hooks.mjs --approvals` ile kurulur.
//
// GÜVENLİK KURALLARI:
//  - Karar yazmanın TEK yolu hub'ın açıkça "allow" ya da "deny" demesidir. Hub kapalı, ağ yok, yanlış token,
//    süre doldu, istek iptal, bilinmeyen durum, herhangi bir hata -> stdout'a HİÇBİR ŞEY yazılmaz, çıkış 0:
//    Claude Code normal onay penceresini gösterir (yani varsayılan her zaman "sor").
//  - Özet (komut / dosya yolu) kısaltılır ve bariz sırlar (token, parola, anahtar) maskelenir.
//    Dosya içeriği hiç gönderilmez. HOMEDECK_APPROVAL_DETAIL=0 ise yalnızca araç adı gider.
//  - Terminalden cevap verilirse Claude Code bu betiği sonlandırır; betik hub'a "iptal" bildirir.
//
// Ayar: agent ile aynı dosya (agent.config.json: hub, token). Kapatmak için: "approvals": false ya da HOMEDECK_APPROVALS=0.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const POLL_MS = 1000;
const MAX_WAIT_S = 85;              // hub 90 sn tutar; Claude Code kanca zaman aşımı 100 sn
const DOWN_MS = 60000;              // hub'a ulaşılamazsa bu sürece hiç deneme (devre kesici)
const downFile = path.join(os.tmpdir(), 'homedeck-approve-down.json');

const isDown = () => { try { return Date.now() < JSON.parse(fs.readFileSync(downFile, 'utf8')).until; } catch (e) { return false; } };
const trip = () => { try { fs.writeFileSync(downFile, JSON.stringify({ until: Date.now() + DOWN_MS })); } catch (e) { /* önemsiz */ } };

function configPath() {
  if (process.env.HOMEDECK_CONFIG) return process.env.HOMEDECK_CONFIG;
  const win = process.platform === 'win32' ? 'C:\\HomeDeckAgent\\agent.config.json' : null;
  const unix = path.join(os.homedir(), '.homedeck-agent', 'agent.config.json');
  return win && fs.existsSync(win) ? win : unix;
}

function readStdin() {
  return new Promise((resolve) => {
    let buf = '';
    const t = setTimeout(() => resolve(buf), 1500);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { buf += c; if (buf.length > 2_000_000) buf = buf.slice(0, 2_000_000); });
    process.stdin.on('end', () => { clearTimeout(t); resolve(buf); });
    process.stdin.on('error', () => { clearTimeout(t); resolve(buf); });
  });
}

function mask(s) {
  return String(s)
    .replace(/\b(sk|pk|ghp|gho|ghs|github_pat|xox[abpr]|AKIA)[-_A-Za-z0-9]{12,}/g, '$1•••')
    .replace(/\b(token|key|secret|passw(?:or)?d|pwd|auth|bearer)(\s*[=:]\s*|\s+)\S{4,}/gi, '$1$2•••');
}

function summarize(j) {
  if (process.env.HOMEDECK_APPROVAL_DETAIL === '0') return '';
  const t = j.tool_input && typeof j.tool_input === 'object' ? j.tool_input : {};
  const v = [t.command, t.file_path, t.path, t.url, t.pattern, t.query, t.description].find((x) => typeof x === 'string' && x.trim());
  return v ? mask(v.replace(/\s+/g, ' ').trim()).slice(0, 160) : '';
}

const out = (behavior, message) => {
  const decision = message ? { behavior, message } : { behavior };
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } }) + '\n');
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  let j;
  try { j = JSON.parse(await readStdin()); } catch (e) { return; }
  if (!j || j.hook_event_name !== 'PermissionRequest' || !j.session_id || typeof j.tool_name !== 'string') return;

  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(configPath(), 'utf8').replace(/^﻿/, '')); } catch (e) { return; }
  if (cfg.approvals === false || process.env.HOMEDECK_APPROVALS === '0') return;
  if (isDown()) return;
  const hub = String(process.env.HOMEDECK_URL || cfg.hub || '').replace(/\/$/, '');
  const token = process.env.HOMEDECK_TOKEN || cfg.token || '';
  if (!hub || !token) return;
  const auth = { Authorization: 'Bearer ' + token };

  let id = '';
  try {
    const res = await fetch(hub + '/api/approval', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify({
        tool: j.tool_name,
        summary: summarize(j),
        project: String(j.cwd || '').split(/[\\/]/).filter(Boolean).pop() || '',
      }),
      signal: AbortSignal.timeout(1500),
    });
    if (res.status === 201) id = String((await res.json()).id || '');
    else if (res.status !== 429) trip(); // kapalı (403) / yetkisiz / hata: bir süre hiç deneme
  } catch (e) { trip(); }
  if (!/^[0-9a-f]{24}$/.test(id)) return;

  const cancel = () => { fetch(hub + '/api/approval/' + id, { method: 'DELETE', headers: auth, signal: AbortSignal.timeout(500) }).catch(() => {}); };
  // Terminalden cevaplanınca Claude Code beni sonlandırır: hub'a haber ver, sonra çık
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, () => { cancel(); setTimeout(() => process.exit(0), 300); });

  const maxMs = Math.min(MAX_WAIT_S, Math.max(5, Number(cfg.approvalWaitSec) || MAX_WAIT_S)) * 1000;
  const until = Date.now() + maxMs;
  let errs = 0;
  while (Date.now() < until) {
    await sleep(POLL_MS);
    try {
      const res = await fetch(hub + '/api/approval/' + id, { headers: auth, signal: AbortSignal.timeout(2000) });
      if (res.status !== 200) return;
      const st = (await res.json()).status;
      errs = 0;
      if (st === 'allow') { out('allow'); return; }
      if (st === 'deny') { out('deny', 'HomeDeck ekranından reddedildi'); return; }
      if (st !== 'pending') return; // expired / cancelled / unknown: normal pencere
    } catch (e) {
      if (++errs >= 3) { cancel(); return; }
    }
  }
  cancel(); // süre doldu: normal pencereye dön
}

main().catch(() => {}).finally(() => setTimeout(() => process.exit(0), 50));
