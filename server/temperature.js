// Islemci sicakligi (Linux sysfs). Once hwmon (coretemp/k10temp...), sonra thermal_zone. Her dosya ayri try/catch:
// bozuk/okunamayan bir sensor digerlerini engellemez. Disk (nvme/drivetemp) sensorleri CPU sicakligi sayilmaz.
// Donus: { value: <derece C>, source: '<kaynak adi>' } ya da null.
import fs from 'node:fs';
import path from 'node:path';

const CPU_CHIPS = new Set(['coretemp', 'k10temp', 'zenpower', 'cpu_thermal', 'soc_thermal', 'cpu-thermal', 'x86_pkg_temp']);
const DISK_CHIPS = /^(nvme|drivetemp|sd|hdd|ssd)/i;

function readText(file) {
  try { return fs.readFileSync(file, 'utf8').trim(); } catch (e) { return null; }
}
function readMilli(file) {
  const t = readText(file);
  if (t === null) return null;
  const n = Number(t) / 1000;
  return Number.isFinite(n) && n > 1 && n < 130 ? n : null; // 0 / sacma degerleri ele
}
function ls(dir) {
  try { return fs.readdirSync(dir); } catch (e) { return []; }
}

// roots: ['/sys', '/host/sys'] gibi; ilk bulunan kaynak grubu kazanir.
export function readTemperature(roots) {
  const groups = { 0: [], 1: [], 2: [] }; // 0: CPU cipi, 1: genel termal bolge, 2: diger hwmon
  for (const root of roots) {
    if (!root) continue;
    // hwmon
    const hw = path.join(root, 'class', 'hwmon');
    for (const d of ls(hw)) {
      const dir = path.join(hw, d);
      const name = readText(path.join(dir, 'name')) || d;
      if (DISK_CHIPS.test(name)) continue;
      const vals = [];
      for (const f of ls(dir)) {
        if (!/^temp\d+_input$/.test(f)) continue;
        const v = readMilli(path.join(dir, f));
        if (v !== null) vals.push(v);
      }
      if (vals.length) groups[CPU_CHIPS.has(name) ? 0 : 2].push({ value: Math.max(...vals), source: name });
    }
    // thermal_zone
    const th = path.join(root, 'class', 'thermal');
    for (const d of ls(th)) {
      if (!d.startsWith('thermal_zone')) continue;
      const type = readText(path.join(th, d, 'type')) || d;
      if (DISK_CHIPS.test(type)) continue;
      const v = readMilli(path.join(th, d, 'temp'));
      if (v !== null) groups[CPU_CHIPS.has(type) ? 0 : 1].push({ value: v, source: type });
    }
    if (groups[0].length || groups[1].length || groups[2].length) break; // bu kokte bulduk, digerine bakma
  }
  for (const g of [0, 1, 2]) {
    if (groups[g].length) return groups[g].reduce((a, b) => (b.value > a.value ? b : a));
  }
  return null;
}
