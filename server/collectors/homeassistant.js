// Home Assistant cihazlari (YALNIZ OKUMA): hava temizleyici (fan + sensorleri), robot supurge (vacuum), kombi/termostat (climate, water_heater).
// HA_URL + HA_TOKEN .env'de. Jeton makineden cikmaz; ekrana yalniz secili alanlar gider (konum/kisi/diger varliklar HIC gonderilmez).
// HA'ya cihaz eklendikce kendiliginden gorunur: vacuum.* / climate.* / water_heater.* / fan.* (+ ayni onekli sensorler).
const HA_URL = (process.env.HA_URL || '').replace(/\/$/, '');
const HA_TOKEN = process.env.HA_TOKEN || '';

const clip = (s, n) => String(s === null || s === undefined ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);
const bad = (s) => s === 'unavailable' || s === 'unknown' || s === '' || s === null || s === undefined;
const num = (v) => { if (bad(v)) return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const objId = (id) => String(id).split('.').slice(1).join('.');

// Havada sensor eslemesi: ayni cihazin sensorleri entity_id onekini paylasir (fan.zhimi_x -> sensor.zhimi_x_*)
function fanSensors(prefix, sensors) {
  const out = { pm25: null, humidity: null, temperature: null, filterLeft: null, filterHours: null, rpm: null };
  for (const s of sensors) {
    const oid = objId(s.entity_id);
    if (oid !== prefix && !oid.startsWith(prefix + '_')) continue;
    const a = s.attributes || {}, dc = a.device_class, v = num(s.state);
    if (v === null) continue;
    const txt = (oid + ' ' + (a.friendly_name || '')).toLowerCase();
    if (dc === 'pm25' || /pm2[._]?5/.test(txt)) out.pm25 = v;
    else if (dc === 'humidity') out.humidity = v;
    else if (dc === 'temperature') out.temperature = v;
    else if (/filtre.*(omr|ömr)|filter.*(life|remaining|left)/.test(txt)) out.filterLeft = v;
    else if (/filtre.*kullan|filter.*(used|hours|usage)/.test(txt)) out.filterHours = dc === 'duration' && a.unit_of_measurement === 'min' ? v / 60 : v;
    else if (/motor|rpm|fan_speed/.test(txt)) out.rpm = v;
  }
  return out;
}

// HA /api/states cevabi -> ekran verisi (saf fonksiyon, test edilir)
export function normalizeStates(states) {
  const list = Array.isArray(states) ? states : [];
  const by = (d) => list.filter((s) => s && typeof s.entity_id === 'string' && s.entity_id.startsWith(d + '.'));
  const sensors = by('sensor');
  const fans = by('fan').slice(0, 4).map((s) => {
    const a = s.attributes || {};
    return {
      id: s.entity_id, name: clip(a.friendly_name, 40), on: s.state === 'on', unavailable: bad(s.state) ,
      percentage: num(a.percentage), mode: a.preset_mode ? clip(a.preset_mode, 20) : null,
      sensors: fanSensors(objId(s.entity_id), sensors),
    };
  });
  const vacuums = by('vacuum').slice(0, 3).map((s) => {
    const a = s.attributes || {}, oid = objId(s.entity_id);
    // Pil: eski entegrasyonlar vacuum.battery_level verir, yenileri ayri sensor (sensor.<ad>_battery / device_class battery) acar
    const bs = sensors.find((x) => { const o = objId(x.entity_id); return o === oid + '_battery' || (x.attributes && x.attributes.device_class === 'battery' && o.startsWith(oid + '_')); });
    const battery = num(a.battery_level) !== null ? num(a.battery_level) : (bs ? num(bs.state) : null);
    return { id: s.entity_id, name: clip(a.friendly_name, 40), state: clip(s.state, 20), battery, fanSpeed: a.fan_speed ? clip(a.fan_speed, 20) : null, status: a.status ? clip(a.status, 40) : null };
  });
  const climates = by('climate').slice(0, 4).map((s) => {
    const a = s.attributes || {};
    return { id: s.entity_id, kind: 'climate', name: clip(a.friendly_name, 40), mode: clip(s.state, 20), action: a.hvac_action ? clip(a.hvac_action, 20) : null,
      current: num(a.current_temperature), target: num(a.temperature), humidity: num(a.current_humidity), preset: a.preset_mode ? clip(a.preset_mode, 20) : null };
  });
  for (const s of by('water_heater').slice(0, 2)) {
    const a = s.attributes || {};
    climates.push({ id: s.entity_id, kind: 'water', name: clip(a.friendly_name, 40), mode: clip(s.state, 20), action: null, current: num(a.current_temperature), target: num(a.temperature), humidity: null, preset: null });
  }
  return { fans, vacuums, climates };
}

export default {
  name: 'ha',
  interval: 15 * 1000,
  async run() {
    if (!HA_URL || !HA_TOKEN) throw new Error('HA_URL / HA_TOKEN tanımlı değil');
    const res = await fetch(HA_URL + '/api/states', { headers: { Authorization: 'Bearer ' + HA_TOKEN }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error('home assistant http ' + res.status);
    return { data: normalizeStates(await res.json()), simulated: false };
  },
};
