// Sunucu metrikleri: CPU, RAM, disk, sicaklik, ag hizi (Linux /proc). Linux disinda simule eder.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { readTemperature } from '../temperature.js';

const HAS_PROC = fs.existsSync('/proc/stat');
const HIST = 150;
const DISK_PATH = process.env.DISK_PATH || '/';

const hist = { cpu: [], rx: [], tx: [] };
let prevCpu = null;
let prevNet = null;
let diskCache = { ts: 0, value: null };
let sim = { cpu: 20, ram: 55, rx: 2, tx: 0.5 };

function push(arr, v) {
  arr.push(v);
  if (arr.length > HIST) arr.shift();
}

function readCpu() {
  const parts = fs
    .readFileSync('/proc/stat', 'utf8')
    .split('\n')[0]
    .trim()
    .split(/\s+/)
    .slice(1)
    .map(Number);
  const idle = parts[3] + (parts[4] || 0);
  const total = parts.reduce((a, b) => a + b, 0);
  return { idle, total };
}

function readMem() {
  const txt = fs.readFileSync('/proc/meminfo', 'utf8');
  const get = (k) => Number((txt.match(new RegExp('^' + k + ':\\s+(\\d+)', 'm')) || [])[1] || 0) * 1024;
  const total = get('MemTotal');
  const avail = get('MemAvailable');
  return { total, used: total - avail };
}

function readNet() {
  const lines = fs.readFileSync('/proc/net/dev', 'utf8').split('\n').slice(2);
  let rx = 0;
  let tx = 0;
  for (const line of lines) {
    const m = line.trim().match(/^([^:]+):\s*(.*)$/);
    if (!m) continue;
    const name = m[1];
    if (/^(lo|docker|veth|br-|virbr|tailscale|zt)/.test(name)) continue;
    const f = m[2].split(/\s+/).map(Number);
    rx += f[0];
    tx += f[8];
  }
  return { rx, tx, t: Date.now() };
}

// Konteynerde /sys bos/kisitli olabilir; host kok dizini DISK_PATH altinda (ornek /host) takili ise oradaki /sys de denenir.
const TEMP_ROOTS = ['/sys', DISK_PATH !== '/' ? path.join(DISK_PATH, 'sys') : null];
function readTemp() {
  return readTemperature(TEMP_ROOTS); // { value, source } ya da null
}

function readDisk() {
  return new Promise((resolve) => {
    if (Date.now() - diskCache.ts < 30000 && diskCache.value) return resolve(diskCache.value);
    execFile('df', ['-kP', DISK_PATH], (err, out) => {
      if (err) return resolve(diskCache.value);
      const cols = out.trim().split('\n').pop().split(/\s+/);
      const total = Number(cols[1]) * 1024;
      const used = Number(cols[2]) * 1024;
      diskCache = { ts: Date.now(), value: { total, used } };
      resolve(diskCache.value);
    });
  });
}

function walk(v, min, max, step) {
  return Math.max(min, Math.min(max, v + (Math.random() - 0.5) * step));
}

async function real() {
  const cur = readCpu();
  let cpu = 0;
  if (prevCpu) {
    const dt = cur.total - prevCpu.total;
    const di = cur.idle - prevCpu.idle;
    cpu = dt > 0 ? (1 - di / dt) * 100 : 0;
  }
  prevCpu = cur;

  const net = readNet();
  let rx = 0;
  let tx = 0;
  if (prevNet) {
    const dt = (net.t - prevNet.t) / 1000;
    if (dt > 0) {
      rx = Math.max(0, ((net.rx - prevNet.rx) * 8) / 1e6 / dt); // Mbit/s
      tx = Math.max(0, ((net.tx - prevNet.tx) * 8) / 1e6 / dt);
    }
  }
  prevNet = net;

  const up = Number(fs.readFileSync('/proc/uptime', 'utf8').split(' ')[0]);
  const t = readTemp();
  return {
    cpu,
    mem: readMem(),
    disk: await readDisk(),
    temp: t ? t.value : null,
    tempSource: t ? t.source : null,
    load: os.loadavg(),
    cores: os.cpus().length,
    uptime: up,
    rx,
    tx,
  };
}

function simulated() {
  sim.cpu = walk(sim.cpu, 3, 90, 14);
  sim.ram = walk(sim.ram, 30, 85, 2);
  sim.rx = walk(sim.rx, 0, 220, sim.rx > 100 ? 80 : 18);
  sim.tx = walk(sim.tx, 0, 40, 6);
  const total = 16 * 1024 ** 3;
  return {
    cpu: sim.cpu,
    mem: { total, used: (total * sim.ram) / 100 },
    disk: { total: 1e12, used: 4.1e11 },
    temp: 41 + sim.cpu / 6,
    tempSource: 'demo',
    load: [sim.cpu / 25, sim.cpu / 28, sim.cpu / 30],
    cores: 8,
    uptime: os.uptime(),
    rx: sim.rx,
    tx: sim.tx,
  };
}

export default {
  name: 'system',
  interval: 2000,
  async run() {
    const d = HAS_PROC ? await real() : simulated();
    push(hist.cpu, +d.cpu.toFixed(1));
    push(hist.rx, +d.rx.toFixed(2));
    push(hist.tx, +d.tx.toFixed(2));
    return { data: { ...d, hist: { cpu: hist.cpu, rx: hist.rx, tx: hist.tx } }, simulated: !HAS_PROC };
  },
};
