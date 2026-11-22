// Evin ana internet sayaci: modemin UPnP (IGD) arayuzunden toplam bayt sayaclari (salt okunur "Get" cagrilari, sifre gerekmez).
// Modem: UPnP/IGD destekleyen bir modem (adres ornegi: MODEM_UPNP=http://MODEM_IP:PORT, gatedesc.xml'in oldugu adres). Ayarlanmazsa kapali. Sayaç 32 bit'tir (4,29 GB'da basa sarar): hiz hesabi sarmayi ve modem yeniden baslamasini ayirir.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = (process.env.MODEM_UPNP || '').replace(/\/$/, '');
const TZ = process.env.MODEM_TZ || 'Europe/Istanbul';
const WRAP = 4294967296; // 2^32
const MAX_BPS = 1.1e9 / 8; // hat 1 Gbit/s: bunun ustu hiz = olculemez, sifirlanma sayilir
const HIST = 90;
const WINDOW_MS = 30000; // modem sayaci parca parca guncelliyor: hizi son 30 sn'nin ortalamasi olarak goster
const here = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(here, '..', '..', 'data');
const USAGE_FILE = path.join(DATA_DIR, 'modem-usage.json');

// Iki ardisik sayac okumasi arasindaki bayt farki (saf fonksiyon, test edilir).
// Donus: bayt farki ya da null (sifirlanma/olculemez: ornek atilir).
export function counterDelta(prev, cur, dtSec) {
  if (!(dtSec > 0) || !isFinite(prev) || !isFinite(cur)) return null;
  let d = cur - prev;
  if (d < 0) d += WRAP;                  // 32 bit sarma
  if (d / dtSec > MAX_BPS) return null;  // mantiksiz hiz: modem yeniden baslamis olabilir
  return d;
}

// Pencere ortalamasi (saf fonksiyon, test edilir): samples=[{t, dRx, dTx}] -> {rx, tx} Mbit/s ya da null
export function windowRate(samples, now, windowMs) {
  const w = samples.filter((x) => now - x.t <= windowMs);
  if (w.length < 2) return null;
  const span = (w[w.length - 1].t - w[0].t) / 1000 + (w[0].dt || 0); // ilk orneğin kapsadigi sure dahil
  if (!(span > 0)) return null;
  let rx = 0, tx = 0;
  for (const x of w) { rx += x.dRx; tx += x.dTx; }
  return { rx: rx * 8 / 1e6 / span, tx: tx * 8 / 1e6 / span };
}

const dayKey = (t) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(t)); // YYYY-MM-DD

let ctrl = null;       // { url, type } WANCommonInterfaceConfig kontrol adresi
let prev = null;       // { rx, tx, t }
let samples = [];      // son penceredeki farklar [{t, dt, dRx, dTx}]
let hist = { rx: [], tx: [] };
let usage = { day: dayKey(Date.now()), rx: 0, tx: 0 };
let usageDirty = false, lastSave = 0;
try { const u = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8')); if (u && typeof u.rx === 'number' && typeof u.tx === 'number' && typeof u.day === 'string') usage = u; } catch (e) { /* ilk calisma */ }

async function discover() {
  const xml = await (await fetch(BASE + '/gatedesc.xml', { signal: AbortSignal.timeout(6000) })).text();
  const m = /<serviceType>([^<]*WANCommonInterfaceConfig[^<]*)<\/serviceType>[\s\S]*?<controlURL>([^<]+)<\/controlURL>/.exec(xml);
  if (!m) throw new Error('modem UPnP: WANCommonInterfaceConfig bulunamadı');
  ctrl = { type: m[1], url: BASE + m[2] };
}

async function soap(action) {
  const body = '<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:' + action + ' xmlns:u="' + ctrl.type + '"/></s:Body></s:Envelope>';
  const res = await fetch(ctrl.url, { method: 'POST', body, headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPAction: '"' + ctrl.type + '#' + action + '"' }, signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error('modem UPnP http ' + res.status + ' (' + action + ')');
  return res.text();
}
const pick = (xml, tag) => { const m = new RegExp('<' + tag + '[^>]*>([^<]*)<').exec(xml); return m ? Number(m[1]) : NaN; };

function saveUsage(now) {
  if (!usageDirty || now - lastSave < 60000) return;
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(USAGE_FILE, JSON.stringify(usage)); usageDirty = false; lastSave = now; } catch (e) { /* kalici degil: sorun degil */ }
}

let failures = 0;
const collector = {
  name: 'modem',
  interval: 5000, // hata surerse 60 sn'ye cikar (modem/UPnP kapaliysa log'u ve agi bogma); toparlaninca 5 sn'ye doner
  async run() {
    try {
      if (!ctrl) await discover();
      const [r, s] = await Promise.all([soap('GetTotalBytesReceived'), soap('GetTotalBytesSent')]);
      var rx = pick(r, 'NewTotalBytesReceived'), tx = pick(s, 'NewTotalBytesSent');
      if (!isFinite(rx) || !isFinite(tx)) throw new Error('modem sayaç değeri okunamadı');
    } catch (e) {
      ctrl = null; // adres/port degismis olabilir: sonraki turda tanimi yeniden al
      prev = null; samples = []; // kesinti sonrasi eski okumayla hiz hesaplama
      if (++failures >= 3) collector.interval = 60000;
      throw e;
    }
    failures = 0; collector.interval = 5000;
    const now = Date.now();
    let mbRx = null, mbTx = null;
    if (prev) {
      const dt = (now - prev.t) / 1000, dRx = counterDelta(prev.rx, rx, dt), dTx = counterDelta(prev.tx, tx, dt);
      if (dRx !== null && dTx !== null) {
        if (dayKey(now) !== usage.day) usage = { day: dayKey(now), rx: 0, tx: 0 };
        usage.rx += dRx; usage.tx += dTx; usageDirty = true;
        samples.push({ t: now, dt, dRx, dTx });
        samples = samples.filter((x) => now - x.t <= WINDOW_MS * 2);
        const r = windowRate(samples, now, WINDOW_MS);
        if (r) {
          mbRx = r.rx; mbTx = r.tx;
          for (const [k, v] of [['rx', mbRx], ['tx', mbTx]]) { hist[k].push(+v.toFixed(2)); if (hist[k].length > HIST) hist[k].shift(); }
        }
      } else {
        samples = []; // sifirlanma/olculemez ornek: pencereyi bastan baslat
      }
    }
    prev = { rx, tx, t: now };
    saveUsage(now);
    return {
      data: { rx: mbRx, tx: mbTx, todayRx: usage.rx, todayTx: usage.tx, day: usage.day, hist: { rx: hist.rx.slice(), tx: hist.tx.slice() }, link: 'Up' },
      simulated: false,
    };
  },
};

export default collector;
