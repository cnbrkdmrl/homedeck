// Hava durumu: Open-Meteo (anahtarsiz). WEATHER_LAT / WEATHER_LON / WEATHER_CITY ile ayarla.
const LAT = process.env.WEATHER_LAT || '41.01';
const LON = process.env.WEATHER_LON || '28.97';
const CITY = process.env.WEATHER_CITY || 'Istanbul';

const URL_ =
  'https://api.open-meteo.com/v1/forecast?latitude=' +
  LAT +
  '&longitude=' +
  LON +
  '&current=temperature_2m,apparent_temperature,weather_code,is_day' +
  '&hourly=temperature_2m,weather_code,precipitation_probability,is_day' +
  '&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,precipitation_probability_max' +
  '&timezone=auto&forecast_days=7';

let everOk = false;

export default {
  name: 'weather',
  interval: 10 * 60 * 1000,
  async run() {
    try {
      const res = await fetch(URL_, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error('open-meteo http ' + res.status);
      const j = await res.json();
      everOk = true;
      // Saatlik: su anki saatten itibaren 24 saat. Open-Meteo saatleri konumun yerel saatiyle (ofsetsiz) verir.
      const cur = String(j.current.time || '').slice(0, 13); // 'YYYY-MM-DDTHH'
      let i0 = (j.hourly && j.hourly.time ? j.hourly.time : []).findIndex((t) => String(t).slice(0, 13) === cur);
      if (i0 < 0) i0 = 0;
      const hours = [];
      if (j.hourly && j.hourly.time) {
        for (let k = i0; k < j.hourly.time.length && hours.length < 24; k++) {
          hours.push({
            time: j.hourly.time[k],
            temp: j.hourly.temperature_2m[k],
            code: j.hourly.weather_code[k],
            pop: j.hourly.precipitation_probability ? j.hourly.precipitation_probability[k] : null,
            isDay: j.hourly.is_day ? j.hourly.is_day[k] === 1 : true,
          });
        }
      }
      return {
        data: {
          city: CITY,
          utcOffset: j.utc_offset_seconds || 0, // istemci "su an" ve gun ilerlemesi icin
          hours,
          temp: j.current.temperature_2m,
          feels: j.current.apparent_temperature,
          code: j.current.weather_code,
          isDay: j.current.is_day === 1,
          days: j.daily.time.map((t, i) => ({
            date: t,
            code: j.daily.weather_code[i],
            max: j.daily.temperature_2m_max[i],
            min: j.daily.temperature_2m_min[i],
            sunrise: j.daily.sunrise ? j.daily.sunrise[i] : null,
            sunset: j.daily.sunset ? j.daily.sunset[i] : null,
            uv: j.daily.uv_index_max ? j.daily.uv_index_max[i] : null,
            pop: j.daily.precipitation_probability_max ? j.daily.precipitation_probability_max[i] : null,
          })),
        },
        simulated: false,
      };
    } catch (err) {
      if (everOk) throw err; // onceki gercek veri "eski" olarak kalsin
      const today = new Date();
      const days = [0, 1, 2, 3, 4].map((i) => {
        const d = new Date(today.getTime() + i * 86400000);
        return { date: d.toISOString().slice(0, 10), code: [2, 3, 61, 1, 0][i], max: 14 - i, min: 8 - i };
      });
      return { data: { city: CITY, utcOffset: 10800, hours: [], temp: 11, feels: 9, code: 3, isDay: true, days }, simulated: true };
    }
  },
};
