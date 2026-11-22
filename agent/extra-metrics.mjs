// Ek makine metrikleri: GPU, pil, en cok RAM kullanan uygulamalar, harici (USB) diskler.
// agent.js bunu dinamik import eder; modul yoksa/bozuksa agent CPU/RAM/disk/ag gondermeye devam eder.
// Saf ayristiricilar (parse*) test edilebilir; toplayici (createExtraMetrics) arka planda kendi zamanlayicilariyla tazeler,
// agent'in 3 sn'lik dongusunu ASLA bekletmez (snapshot() sadece onbellegi dondurur).
import fs from 'node:fs';

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

// ---------- ayristiricilar ----------
// nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw --format=csv,noheader,nounits
export function parseNvidiaSmi(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const f = line.split(',').map((s) => s.trim());
    if (f.length < 6 || !f[0]) continue;
    out.push({
      name: f[0].replace(/^NVIDIA\s+(GeForce\s+)?/i, '').slice(0, 40),
      util: num(f[1]),
      memUsed: num(f[2]) === null ? null : num(f[2]) * 1048576, // MiB -> bayt
      memTotal: num(f[3]) === null ? null : num(f[3]) * 1048576,
      temp: num(f[4]),
      power: num(f[5]),
    });
  }
  return out;
}

// ioreg -r -d 1 -w0 -c IOAccelerator  (Apple Silicon)
export function parseIoregGpu(text) {
  const out = [];
  for (const block of String(text || '').split(/\n(?=\+-o )/)) {
    const util = /"Device Utilization %"=(\d+)/.exec(block);
    if (!util) continue;
    const model = /"model" = "([^"]+)"/.exec(block);
    out.push({ name: (model ? model[1] : 'GPU').slice(0, 40), util: Number(util[1]), memUsed: null, memTotal: null, temp: null, power: null });
  }
  return out;
}

// pmset -g batt
export function parsePmsetBatt(text) {
  const m = /(\d{1,3})%;\s*([^;]+);/.exec(String(text || ''));
  if (!m || !/InternalBattery/.test(text)) return null;
  const state = m[2].trim().toLowerCase();
  return {
    pct: Math.min(100, Number(m[1])),
    charging: state === 'charging' || state === 'finishing charge',
    plugged: state !== 'discharging',
  };
}

// uygulama adini cikar: ".app" paketi varsa onun adi (Chrome/Helper'lar tek satirda toplansin), yoksa dosya adi
export function procName(comm) {
  const s = String(comm || '');
  const app = /\/([^/]+)\.app(\/|$)/.exec(s);
  if (app) return app[1];
  const base = s.split(/[\\/]/).pop() || s;
  return base.replace(/\.exe$/i, '');
}

// [{name, rss(bayt)}] -> ada gore topla, en buyuk n tanesi
export function topProcs(list, n) {
  const map = new Map();
  for (const p of list) {
    if (!p.name || !(p.rss > 0)) continue;
    const key = p.name.toLowerCase();
    const cur = map.get(key);
    if (cur) cur.mem += p.rss; else map.set(key, { name: p.name.slice(0, 30), mem: p.rss });
  }
  return [...map.values()].sort((a, b) => b.mem - a.mem).slice(0, n || 5);
}

// ps -axo rss=,comm= (macOS)
export function parsePs(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const m = /^\s*(\d+)\s+(.+)$/.exec(line);
    if (m) out.push({ name: procName(m[2]), rss: Number(m[1]) * 1024 });
  }
  return out;
}

// diskutil info <mount> (macOS): harici/cikarilabilir mi?
export function parseDiskutilExternal(text) {
  const t = String(text || '');
  if (!t) return false;
  const loc = /Device Location:\s*(\w+)/.exec(t);
  if (loc) return loc[1].toLowerCase() === 'external';
  return /Removable Media:\s*Removable/i.test(t);
}

// Windows tek PowerShell cagrisinin JSON'u: {b:{EstimatedChargeRemaining,BatteryStatus}, p:[{n,m}], u:["E:"]}
export function parseWinJson(text) {
  let j;
  try { j = JSON.parse(String(text || '').trim()); } catch (e) { return null; }
  if (!j || typeof j !== 'object') return null;
  const arr = (v) => (v === null || v === undefined ? [] : Array.isArray(v) ? v : [v]);
  let battery = null;
  if (j.b && num(j.b.EstimatedChargeRemaining) !== null) {
    const st = num(j.b.BatteryStatus);
    battery = { pct: Math.min(100, num(j.b.EstimatedChargeRemaining)), charging: [6, 7, 8, 9, 11].indexOf(st) >= 0, plugged: st !== 1 && st !== 4 && st !== 5 };
  }
  return {
    battery,
    procs: arr(j.p).map((x) => ({ name: String(x.n || ''), rss: num(x.m) || 0 })),
    usb: arr(j.u).map((x) => String(x).toUpperCase()),
  };
}

// Linux: /proc/<pid>/status icerigi -> {name, rss}
export function parseProcStatus(text) {
  const n = /^Name:\s*(.+)$/m.exec(text), r = /^VmRSS:\s*(\d+)\s*kB/m.exec(text);
  return n && r ? { name: n[1].trim(), rss: Number(r[1]) * 1024 } : null;
}

// Linux: /dev/sdb1 -> USB'ye bagli mi? (/sys/block/sdb gercek yolunda "/usb" gecer). nvme/mmc/sata disk USB sayilmaz.
export function linuxIsUsbDev(dev, fsApi) {
  const f = fsApi || fs;
  const m = /^\/dev\/(sd[a-z]+|vd[a-z]+)\d*$/.exec(String(dev || ''));
  if (!m) return false;
  try { return /\/usb\d*\//.test(f.realpathSync('/sys/block/' + m[1])); } catch (e) { return false; }
}

// ---------- toplayici ----------
export function createExtraMetrics(opts) {
  const P = opts.platform, run = opts.run, log = opts.log || (() => {});
  const state = { gpus: [], battery: null, procs: [], usbWin: new Set(), usbMac: new Map() };
  let started = false;

  async function gpus() {
    if (P === 'darwin') return parseIoregGpu(await run('ioreg', ['-r', '-d', '1', '-w0', '-c', 'IOAccelerator']));
    const q = ['--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw', '--format=csv,noheader,nounits'];
    const cands = P === 'win32' ? ['nvidia-smi', 'C:\\Windows\\System32\\nvidia-smi.exe', 'C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe'] : ['nvidia-smi'];
    for (const c of cands) {
      const g = parseNvidiaSmi(await run(c, q));
      if (g.length) return g;
    }
    if (P === 'linux') return amdGpus();
    return [];
  }

  // Linux AMD: /sys/class/drm/card*/device/gpu_busy_percent
  function amdGpus() {
    const out = [];
    try {
      for (const d of fs.readdirSync('/sys/class/drm').filter((n) => /^card\d+$/.test(n))) {
        const base = '/sys/class/drm/' + d + '/device/';
        let busy; try { busy = num(fs.readFileSync(base + 'gpu_busy_percent', 'utf8')); } catch (e) { continue; }
        if (busy === null) continue;
        const rd = (f) => { try { return num(fs.readFileSync(base + f, 'utf8')); } catch (e) { return null; } };
        let temp = null;
        try { const h = fs.readdirSync(base + 'hwmon')[0]; temp = h ? (rd('hwmon/' + h + '/temp1_input') || 0) / 1000 || null : null; } catch (e) { /* sensor yok */ }
        out.push({ name: 'AMD GPU', util: busy, memUsed: rd('mem_info_vram_used'), memTotal: rd('mem_info_vram_total'), temp, power: null });
      }
    } catch (e) { /* drm yok */ }
    return out;
  }

  async function battery() {
    if (P === 'darwin') return parsePmsetBatt(await run('pmset', ['-g', 'batt']));
    if (P === 'linux') {
      try {
        for (const d of fs.readdirSync('/sys/class/power_supply').filter((n) => /^BAT/i.test(n))) {
          const b = '/sys/class/power_supply/' + d + '/';
          const pct = num(fs.readFileSync(b + 'capacity', 'utf8'));
          const st = fs.readFileSync(b + 'status', 'utf8').trim().toLowerCase();
          if (pct !== null) return { pct, charging: st === 'charging', plugged: st !== 'discharging' };
        }
      } catch (e) { /* pil yok */ }
    }
    return null; // Windows pili processes ile birlikte tek cagrida gelir
  }

  async function procs() {
    if (P === 'darwin') return topProcs(parsePs(await run('ps', ['-axo', 'rss=,comm='], 6000)), 6);
    if (P === 'linux') {
      const list = [];
      try {
        for (const pid of fs.readdirSync('/proc').filter((n) => /^\d+$/.test(n))) {
          try { const p = parseProcStatus(fs.readFileSync('/proc/' + pid + '/status', 'utf8')); if (p) list.push(p); } catch (e) { /* surec bitti */ }
        }
      } catch (e) { /* proc yok */ }
      return topProcs(list, 6);
    }
    return null;
  }

  const WIN_PS = "$ErrorActionPreference='SilentlyContinue';" +
    '$b=Get-CimInstance Win32_Battery|Select-Object -First 1 EstimatedChargeRemaining,BatteryStatus;' +
    '$p=Get-Process|Group-Object ProcessName|ForEach-Object{[pscustomobject]@{n=$_.Name;m=($_.Group|Measure-Object WorkingSet64 -Sum).Sum}}|Sort-Object m -Descending|Select-Object -First 8;' +
    "$u=Get-Disk|Where-Object BusType -eq 'USB'|Get-Partition|Where-Object DriveLetter|ForEach-Object{\"$($_.DriveLetter):\"};" +
    '@{b=$b;p=@($p);u=@($u)}|ConvertTo-Json -Compress -Depth 4';

  async function winAll() {
    const j = parseWinJson(await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WIN_PS], 20000));
    if (!j) return;
    state.battery = j.battery;
    state.procs = topProcs(j.procs, 6);
    state.usbWin = new Set(j.usb);
  }

  async function macUsb(mounts) {
    for (const m of mounts) {
      if (!m.startsWith('/Volumes/')) continue;
      state.usbMac.set(m, parseDiskutilExternal(await run('diskutil', ['info', m], 6000)));
    }
  }

  async function safe(name, fn) { try { await fn(); } catch (e) { log('[extra] ' + name + ' hatasi: ' + (e && e.message)); } }

  function loop(name, ms, fn) {
    const go = async () => { await safe(name, fn); const t = setTimeout(go, ms); if (t.unref) t.unref(); };
    go();
  }

  return {
    start() {
      if (started) return;
      started = true;
      loop('gpu', 5000, async () => { state.gpus = await gpus(); });
      if (P === 'win32') loop('win', 20000, winAll);
      else {
        loop('pil', 30000, async () => { state.battery = await battery(); });
        loop('surec', 10000, async () => { state.procs = await procs(); });
      }
    },
    // agent'in disk listesi icin: bu disk harici/USB mi?
    isUsb(d) {
      if (P === 'win32') return state.usbWin.has(String(d.name || '').toUpperCase());
      if (P === 'darwin') return state.usbMac.get(d.mount) === true;
      if (P === 'linux') return linuxIsUsbDev(d.dev);
      return false;
    },
    async refreshMacUsb(mounts) { if (P === 'darwin') await macUsb(mounts); },
    snapshot() { return { gpus: state.gpus, battery: state.battery, procs: state.procs }; },
  };
}
