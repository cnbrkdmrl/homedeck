// Yazilabilir ekran duzeni: profil bazli, dogrulamali, yedekli, PIN korumali.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const COLS = 12;
const ROWS = 6;
const MAX_BACKUPS = 10;

export function createLayoutStore({ defaultFile, dataDir, pin, broadcast }) {
  const EDIT_PIN = pin ? String(pin) : '';
  const backupDir = path.join(dataDir, 'backups');
  let fails = 0;
  let lockedUntil = 0;

  const profileOf = (url) => {
    const p = (url.searchParams.get('profile') || 'default').toLowerCase();
    return /^[a-z0-9_-]{1,20}$/.test(p) ? p : 'default';
  };
  const fileOf = (p) => path.join(dataDir, 'layout.' + p + '.json');

  function checkPin(req, res) {
    if (!EDIT_PIN) {
      res.writeHead(403).end('duzenleme kapali: EDIT_PIN ayarla');
      return false;
    }
    if (Date.now() < lockedUntil) {
      res.writeHead(429).end('cok fazla deneme');
      return false;
    }
    const given = Buffer.from(String(req.headers['x-edit-pin'] || ''));
    const want = Buffer.from(EDIT_PIN);
    const ok = given.length === want.length && crypto.timingSafeEqual(given, want);
    if (!ok) {
      fails++;
      if (fails >= 5) {
        lockedUntil = Date.now() + 60000;
        fails = 0;
      }
      res.writeHead(403).end('yanlis pin');
      return false;
    }
    fails = 0;
    return true;
  }

  const int = (v) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : NaN);

  function cleanOpts(o) {
    const out = {};
    if (!o || typeof o !== 'object') return out;
    for (const k of Object.keys(o).slice(0, 10)) {
      if (!/^[a-zA-Z]{1,20}$/.test(k)) continue;
      const v = o[k];
      if (typeof v === 'string') out[k] = v.slice(0, 40);
      else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
      else if (typeof v === 'boolean') out[k] = v;
      else if (Array.isArray(v)) out[k] = v.slice(0, 10).map((x) => String(x).slice(0, 40));
    }
    return out;
  }

  function clean(l) {
    if (!l || !Array.isArray(l.pages) || l.pages.length < 1 || l.pages.length > 16) throw new Error('sayfa sayisi gecersiz');
    const idle = int(l.idleReturnSec);
    const out = { idleReturnSec: idle >= 10 && idle <= 3600 ? idle : 90, pages: [] };
    l.pages.forEach((pg, i) => {
      if (!pg || !Array.isArray(pg.widgets) || pg.widgets.length > 40) throw new Error('widget listesi gecersiz');
      const occ = new Set();
      const widgets = [];
      for (const w of pg.widgets) {
        const c = int(w.col), r = int(w.row), ww = int(w.w), hh = int(w.h);
        if (!/^[a-z][a-z0-9_]{1,24}$/.test(String(w.type))) throw new Error('widget tipi gecersiz');
        if (!(c >= 1 && r >= 1 && ww >= 1 && hh >= 1 && c + ww - 1 <= COLS && r + hh - 1 <= ROWS)) throw new Error('widget sinir disi');
        for (let y = r; y < r + hh; y++) {
          for (let x = c; x < c + ww; x++) {
            const key = y * 100 + x;
            if (occ.has(key)) throw new Error('widgetlar cakisiyor');
            occ.add(key);
          }
        }
        const item = { type: w.type, col: c, row: r, w: ww, h: hh };
        const opts = cleanOpts(w.opts);
        if (Object.keys(opts).length) item.opts = opts;
        if (w.nopad) item.nopad = true;
        widgets.push(item);
      }
      out.pages.push({
        id: String(pg.id || 'p' + i).replace(/[^\w-]/g, '').slice(0, 30) || 'p' + i,
        title: String(pg.title || 'Sayfa').slice(0, 30),
        widgets,
      });
    });
    return out;
  }

  function backup(p) {
    const f = fileOf(p);
    if (!fs.existsSync(f)) return;
    fs.mkdirSync(backupDir, { recursive: true });
    fs.copyFileSync(f, path.join(backupDir, 'layout.' + p + '.' + Date.now() + '.json'));
    const mine = fs.readdirSync(backupDir).filter((n) => n.startsWith('layout.' + p + '.')).sort();
    while (mine.length > MAX_BACKUPS) fs.unlinkSync(path.join(backupDir, mine.shift()));
  }

  function readBody(req, res, cb) {
    let buf = '';
    req.on('data', (c) => {
      buf += c;
      if (buf.length > 262144) req.destroy();
    });
    req.on('end', () => cb(buf));
  }

  function handle(req, res, url) {
    const p = profileOf(url);

    if (url.pathname === '/api/edit/verify' && req.method === 'POST') {
      if (checkPin(req, res)) res.writeHead(204).end();
      return;
    }

    if (req.method === 'GET') {
      const candidates = [fileOf(p), fileOf('default'), defaultFile];
      for (const f of candidates) {
        try {
          const buf = fs.readFileSync(f);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
          res.end(buf);
          return;
        } catch (e) { /* siradaki aday */ }
      }
      res.writeHead(500).end('duzen okunamadi');
      return;
    }

    if (req.method === 'PUT') {
      if (!checkPin(req, res)) return;
      readBody(req, res, (raw) => {
        let layout;
        try {
          layout = clean(JSON.parse(raw));
        } catch (e) {
          res.writeHead(400).end('gecersiz duzen: ' + e.message);
          return;
        }
        layout.rev = Date.now();
        try {
          fs.mkdirSync(dataDir, { recursive: true });
          backup(p);
          const tmp = fileOf(p) + '.tmp';
          fs.writeFileSync(tmp, JSON.stringify(layout, null, 2));
          fs.renameSync(tmp, fileOf(p));
        } catch (e) {
          console.warn('[layout] yazilamadi:', e.message);
          res.writeHead(500).end('yazilamadi');
          return;
        }
        broadcast('layout', { profile: p, rev: layout.rev });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ rev: layout.rev }));
      });
      return;
    }

    if (req.method === 'DELETE') {
      if (!checkPin(req, res)) return;
      try {
        backup(p);
        fs.rmSync(fileOf(p), { force: true });
      } catch (e) { /* yok say */ }
      const rev = Date.now();
      broadcast('layout', { profile: p, rev: rev, reset: true });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ rev }));
      return;
    }

    res.writeHead(405).end('method not allowed');
  }

  return { handle };
}
