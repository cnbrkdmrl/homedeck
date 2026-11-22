// Kota hesaplari (tarayicida klasik script, Node testlerinde vm ile yuklenir). Saf fonksiyonlar, DOM yok.
var QuotaMath = (function () {
  'use strict';
  var STALE_MS = 30 * 60 * 1000; // 30 dk'dan eski okuma "eski" sayilir

  // limit: { percent, resetsAt (ms), windowSec }. Donus:
  //  { expired, pct, resetMin, pace }  pace: null | {kind:'ok'|'full'|'done'|'low', minutes?}
  function view(limit, now) {
    var resetMs = limit.resetsAt ? limit.resetsAt - now : null;
    // Pencerenin sifirlanma zamani gectiyse eldeki yuzde ARTIK GECERLI DEGIL (yeni pencerede bilinmiyor).
    if (resetMs !== null && resetMs <= 0) return { expired: true, pct: null, resetMin: 0, pace: null };
    var pct = limit.percent;
    var out = { expired: false, pct: pct, resetMin: resetMs === null ? null : resetMs / 60000, pace: null };
    if (pct >= 100) { out.pace = { kind: 'done' }; return out; }
    if (pct <= 0) { out.pace = { kind: 'low' }; return out; }
    if (limit.windowSec && resetMs !== null) {
      var elapsedSec = limit.windowSec - resetMs / 1000;
      // Pencerenin ilk %5'inde tahmin gurultulu: tahmin verme
      if (elapsedSec > limit.windowSec * 0.05) {
        var secsToFull = (100 - pct) / (pct / elapsedSec);
        out.pace = secsToFull < resetMs / 1000 ? { kind: 'full', minutes: secsToFull / 60 } : { kind: 'ok' };
      }
    }
    return out;
  }

  function age(observedAt, now) {
    var min = Math.max(0, (now - observedAt) / 60000);
    var text = min < 1 ? 'az önce' : min < 60 ? Math.round(min) + ' dk önce' : min < 1440 ? Math.round(min / 60) + ' sa önce' : Math.round(min / 1440) + ' g önce';
    return { text: text, stale: now - observedAt > STALE_MS };
  }

  return { view: view, age: age, STALE_MS: STALE_MS };
})();
