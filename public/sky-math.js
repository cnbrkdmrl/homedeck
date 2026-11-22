// Gokyuzu/hava hesaplari (tarayicida klasik script, Node testlerinde vm ile yuklenir). Saf fonksiyonlar, DOM yok.
var SkyMath = (function () {
  'use strict';
  var SYNODIC = 29.530588853;              // gun
  var REF_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14); // bilinen bir yeni ay (ms)
  var DAY = 86400000;

  // Ay evresi: frac 0=yeni ay, 0.5=dolunay. illum 0..1 (aydinlik oran).
  function moon(nowMs) {
    var frac = (((nowMs - REF_NEW_MOON) / DAY) / SYNODIC) % 1;
    if (frac < 0) frac += 1;
    var idx = Math.floor(frac * 8 + 0.5) % 8; // 8 dilim, dilimin ortasi
    var names = ['Yeni ay', 'Büyüyen hilal', 'İlk dördün', 'Büyüyen şişkin ay', 'Dolunay', 'Küçülen şişkin ay', 'Son dördün', 'Küçülen hilal'];
    var icons = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'];
    return {
      frac: frac,
      illum: (1 - Math.cos(2 * Math.PI * frac)) / 2,
      name: names[idx], icon: icons[idx],
      daysToFull: ((0.5 - frac + 1) % 1) * SYNODIC,
      daysToNew: ((1 - frac) % 1) * SYNODIC
    };
  }

  // 'YYYY-MM-DDTHH:MM' (konumun yerel saati, ofsetsiz) -> "yerel saat UTC gibi okunmus" ms
  function localMs(str) {
    if (!str) return null;
    var t = Date.parse(String(str).slice(0, 16) + ':00Z');
    return isNaN(t) ? null : t;
  }
  // "Su an" konumun yerel saatiyle, ayni olcekte (localMs ile kiyaslanabilir)
  function nowLocal(nowMs, utcOffsetSec) { return nowMs + (utcOffsetSec || 0) * 1000; }

  // Gunes: {state:'before'|'day'|'after', progress 0..1 (gun icinde), leftMin (gun batimina), toRiseMin}
  function sun(day, nowMs, utcOffsetSec) {
    var rise = localMs(day && day.sunrise), set = localMs(day && day.sunset);
    if (rise === null || set === null || set <= rise) return null;
    var n = nowLocal(nowMs, utcOffsetSec);
    if (n < rise) return { state: 'before', progress: 0, leftMin: 0, toRiseMin: (rise - n) / 60000, lengthMin: (set - rise) / 60000 };
    if (n > set) return { state: 'after', progress: 1, leftMin: 0, toRiseMin: 0, lengthMin: (set - rise) / 60000 };
    return { state: 'day', progress: (n - rise) / (set - rise), leftMin: (set - n) / 60000, toRiseMin: 0, lengthMin: (set - rise) / 60000 };
  }

  // Avrupa hava kalitesi endeksi (EAQI) dilimleri
  var AQI = [
    [20, 'Çok iyi', '#34d399'], [40, 'İyi', '#86efac'], [60, 'Orta', '#fbbf24'],
    [80, 'Kötü', '#fb923c'], [100, 'Çok kötü', '#f87171'], [Infinity, 'Aşırı kötü', '#c084fc']
  ];
  function aqi(v) {
    if (v === null || v === undefined || isNaN(v)) return null;
    for (var i = 0; i < AQI.length; i++) if (v <= AQI[i][0]) return { label: AQI[i][1], color: AQI[i][2] };
    return null;
  }

  // PM2.5 (µg/m³) Avrupa hava kalitesi dilimleri
  var PM25 = [[5, 'Çok iyi', '#34d399'], [15, 'İyi', '#86efac'], [50, 'Orta', '#fbbf24'], [90, 'Kötü', '#fb923c'], [140, 'Çok kötü', '#f87171'], [Infinity, 'Aşırı kötü', '#c084fc']];
  function pm25(v) {
    if (v === null || v === undefined || isNaN(v)) return null;
    for (var i = 0; i < PM25.length; i++) if (v <= PM25[i][0]) return { label: PM25[i][1], color: PM25[i][2] };
    return null;
  }

  // UV endeksi (WHO)
  function uv(v) {
    if (v === null || v === undefined || isNaN(v)) return null;
    if (v < 3) return { label: 'Düşük', color: '#34d399' };
    if (v < 6) return { label: 'Orta', color: '#fbbf24' };
    if (v < 8) return { label: 'Yüksek', color: '#fb923c' };
    if (v < 11) return { label: 'Çok yüksek', color: '#f87171' };
    return { label: 'Aşırı', color: '#c084fc' };
  }

  return { moon: moon, sun: sun, aqi: aqi, pm25: pm25, uv: uv, localMs: localMs, nowLocal: nowLocal };
})();
