// Hava kalitesi: Open-Meteo Air Quality (anahtarsiz). Konum weather ile ayni (WEATHER_LAT / WEATHER_LON).
const LAT = process.env.WEATHER_LAT || '41.01';
const LON = process.env.WEATHER_LON || '28.97';

const URL_ =
  'https://air-quality-api.open-meteo.com/v1/air-quality?latitude=' + LAT + '&longitude=' + LON +
  '&current=european_aqi,pm2_5,pm10,ozone,nitrogen_dioxide,uv_index&timezone=auto';

const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);

export default {
  name: 'air',
  interval: 30 * 60 * 1000,
  async run() {
    const res = await fetch(URL_, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error('open-meteo air http ' + res.status);
    const c = (await res.json()).current || {};
    // Veri yoksa uydurma deger yok: hata firlat, onceki gercek veri "eski" kalir
    if (num(c.european_aqi) === null && num(c.pm2_5) === null) throw new Error('hava kalitesi verisi bos');
    return {
      data: {
        aqi: num(c.european_aqi), pm25: num(c.pm2_5), pm10: num(c.pm10),
        o3: num(c.ozone), no2: num(c.nitrogen_dioxide), uv: num(c.uv_index),
        time: c.time || null,
      },
      simulated: false,
    };
  },
};
