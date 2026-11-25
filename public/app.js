// HomeDeck istemcisi. Eski WebView uyumu icin ?. ve ?? kullanilmiyor.
(function () {
  'use strict';

  var qs = new URLSearchParams(location.search);
  var token = qs.get('token') || '';
  var profile = qs.get('profile') || '';
  function api(p) {
    var q = [];
    if (profile) q.push('profile=' + encodeURIComponent(profile));
    if (token) q.push('token=' + encodeURIComponent(token));
    return p + (q.length ? (p.indexOf('?') >= 0 ? '&' : '?') + q.join('&') : '');
  }

  var S = {};            // sunucu durumu: S[name] = {data, ts, stale, simulated}
  var layout = null;
  var widgetEls = [];    // {el, body, def, impl}
  var uid = 0;
  var COLS = 12, ROWS = 6;
  var DAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
  var DAYS_S = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
  var MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function colorFor(p) { return p < 60 ? '#34d399' : p < 80 ? '#fbbf24' : p < 90 ? '#fb923c' : '#f87171'; }
  function fmtBytes(b) { var u = ['B', 'KB', 'MB', 'GB', 'TB'], i = 0; while (b >= 1024 && i < 4) { b /= 1024; i++; } return (b >= 100 || i === 0 ? b.toFixed(0) : b.toFixed(1)) + ' ' + u[i]; }
  function fmtDur(min) {
    min = Math.max(0, Math.round(min));
    var d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
    if (d > 0) return d + 'g ' + h + 's';
    if (h > 0) return h + 's ' + m + 'dk';
    return m + 'dk';
  }
  function fmtMbit(v) { return v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2); }

  function wxIcon(c, night) { return Icons.wx(c, night); }

  // ---------- SVG yardimcilari ----------
  function ringSVG(pct, label, color) {
    var p = Math.max(0, Math.min(100, pct));
    var C = 2 * Math.PI * 42;
    return '<svg viewBox="0 0 100 100">' +
      '<circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="9"/>' +
      '<circle cx="50" cy="50" r="42" fill="none" stroke="' + color + '" stroke-width="9" stroke-linecap="round" ' +
      'stroke-dasharray="' + (p / 100 * C).toFixed(1) + ' ' + C.toFixed(1) + '" transform="rotate(-90 50 50)"/>' +
      '<text class="ring-txt" x="50" y="50" text-anchor="middle" dominant-baseline="central" font-size="24">' + label + '</text></svg>';
  }

  function lineChart(series, colors, maxHint) {
    var W = 300, H = 100, n = 0, max = maxHint || 1, i, s;
    for (s = 0; s < series.length; s++) { n = Math.max(n, series[s].length); for (i = 0; i < series[s].length; i++) if (series[s][i] > max) max = series[s][i]; }
    if (n < 2) return '<svg viewBox="0 0 300 100"></svg>';
    var out = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">';
    for (var g = 1; g < 4; g++) out += '<line x1="0" x2="' + W + '" y1="' + (H * g / 4) + '" y2="' + (H * g / 4) + '" stroke="rgba(255,255,255,0.06)" stroke-width="0.6"/>';
    for (s = 0; s < series.length; s++) {
      var arr = series[s], pts = [];
      for (i = 0; i < arr.length; i++) {
        var x = W - (arr.length - 1 - i) * (W / (n - 1));
        var y = H - 3 - (arr[i] / max) * (H - 8);
        pts.push(x.toFixed(1) + ',' + y.toFixed(1));
      }
      out += '<polygon points="' + pts[0].split(',')[0] + ',' + H + ' ' + pts.join(' ') + ' ' + W + ',' + H + '" fill="' + colors[s] + '" opacity="0.14"/>';
      out += '<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + colors[s] + '" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>';
    }
    return out + '</svg>';
  }

  // ---------- widget katalogu (galeri, hazir boyutlar, ayarlar) ----------
  // sizes: [etiket, genislik, yukseklik] - ilk boyut en kucuk; galeri varsayilan olarak 'def' indeksini dener
  var CH = [['none', '—'], ['weather', 'Hava durumu'], ['calendar', 'Takvim'], ['nextup', 'Sıradaki etkinlik'], ['worldclock', 'Dünya saatleri'], ['wordclock', 'Kelime saati'], ['clock', 'Saat'], ['fx', 'Döviz'], ['crypto', 'Kripto'], ['gold', 'Altın'], ['hn', 'Hacker News'], ['quota', 'AI kotaları'], ['health', 'Sağlık özeti'], ['sky', 'Güneş ve Ay'], ['airq', 'Hava kalitesi'], ['ha_air', 'Hava temizleyici'], ['ha_vac', 'Robot süpürge'], ['ha_clim', 'Kombi'], ['modem', 'Modem'], ['network', 'İnternet'], ['gitea', 'Gitea'], ['notify', 'Bildirimler'], ['pushvals', 'Gönderilen değerler'], ['sessions', 'AI işleri']];
  var CATALOG = {
    clock:    { name: 'Saat', cat: 'Zaman', icon: 'clock', def: 1, sizes: [['S', 3, 2], ['M', 4, 3], ['L', 6, 3], ['XL', 6, 6]],
                opts: [{ key: 'style', label: 'Stil', choices: [['digital', 'Dijital'], ['analog', 'Analog'], ['animated', 'Animasyonlu']] }], defaults: { style: 'digital' } },
    weather:  { name: 'Hava durumu', cat: 'Zaman', icon: 'cloudsun', def: 0, sizes: [['M', 4, 3], ['L', 6, 3], ['XL', 6, 6]] },
    ha_air:   { name: 'Hava temizleyici', cat: 'Ev', icon: 'wind', def: 1, sizes: [['S', 3, 3], ['M', 4, 3], ['L', 6, 3]] },
    ha_vac:   { name: 'Robot süpürge', cat: 'Ev', icon: 'vac', def: 0, sizes: [['S', 3, 3], ['M', 4, 3], ['L', 6, 3]] },
    ha_clim:  { name: 'Kombi / termostat', cat: 'Ev', icon: 'flame', def: 0, sizes: [['S', 3, 3], ['M', 4, 3], ['L', 6, 3]] },
    calendar: { name: 'Takvim', cat: 'Zaman', icon: 'calendar', def: 1, sizes: [['M', 4, 3], ['L', 6, 3], ['XL', 6, 6]] },
    forecast: { name: 'Hava tahmini', cat: 'Zaman', icon: 'cloud', def: 1, sizes: [['M', 6, 3], ['L', 8, 3], ['XL', 12, 3]],
                opts: [{ key: 'mode', label: 'Görünüm', choices: [['hourly', 'Saatlik'], ['daily', '7 günlük']] }], defaults: { mode: 'hourly' } },
    sky:      { name: 'Güneş ve Ay', cat: 'Zaman', icon: 'sunrise', def: 0, sizes: [['M', 4, 3], ['L', 6, 3], ['XL', 6, 6]] },
    airq:     { name: 'Hava kalitesi', cat: 'Zaman', icon: 'leaf', def: 1, sizes: [['S', 3, 3], ['M', 4, 3], ['L', 6, 3]] },
    ring:     { name: 'Halka (CPU/RAM/Disk)', cat: 'Sistem', icon: 'ring', def: 1, sizes: [['S', 2, 3], ['M', 3, 3], ['L', 4, 4]],
                opts: [{ key: 'metric', label: 'Ölçü', choices: [['cpu', 'CPU'], ['ram', 'RAM'], ['disk', 'Disk'], ['temp', 'Sıcaklık']] }], defaults: { metric: 'cpu' } },
    cpugraph: { name: 'CPU geçmişi', cat: 'Sistem', icon: 'chart', def: 1, sizes: [['S', 4, 2], ['M', 6, 3], ['L', 12, 3]] },
    docker:   { name: 'Docker', cat: 'Sistem', icon: 'box', def: 0, sizes: [['M', 4, 3], ['L', 6, 3], ['XL', 6, 6]] },
    machines: { name: 'Makineler', cat: 'Sistem', icon: 'server', def: 0, sizes: [['L', 12, 4], ['XL', 12, 6]] },
    modem:    { name: 'Modem (ev interneti)', cat: 'Ağ', icon: 'globe', def: 1, sizes: [['S', 3, 2], ['M', 4, 3], ['L', 8, 3], ['XL', 12, 6]] },
    network:  { name: 'İnternet', cat: 'Ağ', icon: 'wifi', def: 1, sizes: [['S', 3, 2], ['M', 4, 3], ['L', 8, 3], ['XL', 12, 6]] },
    quota:    { name: 'AI kotaları', cat: 'AI', icon: 'sparkle', def: 0, sizes: [['M', 6, 3], ['L', 8, 3], ['XL', 12, 6]],
                opts: [{ key: 'provider', label: 'Ajan', choices: [['all', 'Hepsi'], ['claude', 'Claude'], ['codex', 'Codex'], ['antigravity', 'Antigravity']] },
                       { key: 'model', label: 'Model limiti', choices: [['all', 'Hepsi'], ['none', 'Sadece genel'], ['fable', 'Fable'], ['sonnet', 'Sonnet'], ['opus', 'Opus']] }],
                defaults: { provider: 'all', model: 'all' } },
    sessions: { name: 'AI işleri', cat: 'AI', icon: 'bot', def: 0, sizes: [['S', 4, 3], ['L', 6, 6], ['XL', 12, 6]] },
    nextup:   { name: 'Sıradaki etkinlik', cat: 'Zaman', icon: 'skip', def: 1, sizes: [['S', 3, 2], ['M', 4, 3], ['L', 6, 3]] },
    worldclock: { name: 'Dünya saatleri', cat: 'Zaman', icon: 'globe', def: 1, sizes: [['S', 3, 3], ['M', 4, 3], ['L', 6, 3]],
                opts: [{ key: 'set', label: 'Şehirler', choices: [['dunya', 'İstanbul · Londra · New York · Tokyo'], ['avrupa', 'Avrupa'], ['amerika', 'Amerika'], ['asya', 'Asya']] }], defaults: { set: 'dunya' } },
    wordclock: { name: 'Kelime saati', cat: 'Zaman', icon: 'type', def: 1, sizes: [['S', 3, 3], ['M', 4, 3], ['L', 6, 3], ['XL', 6, 6]] },
    fx:       { name: 'Döviz', cat: 'Piyasa', icon: 'exchange', def: 0, sizes: [['S', 3, 2], ['M', 4, 3], ['L', 6, 3]] },
    gold:     { name: 'Altın', cat: 'Piyasa', icon: 'coin', def: 1, sizes: [['S', 3, 2], ['M', 4, 3], ['L', 6, 3]] },
    crypto:   { name: 'Kripto', cat: 'Piyasa', icon: 'bitcoin', def: 1, sizes: [['S', 3, 2], ['M', 4, 3], ['L', 6, 3]] },
    hn:       { name: 'Hacker News', cat: 'Haber', icon: 'news', def: 1, sizes: [['S', 4, 2], ['M', 6, 3], ['L', 8, 3], ['XL', 8, 6]] },
    stack:    { name: 'Akıllı yığın', cat: 'Araçlar', icon: 'layers', def: 1, sizes: [['S', 3, 3], ['M', 4, 3], ['L', 6, 3], ['XL', 6, 6]],
                opts: [{ key: 'a', label: '1. widget', choices: CH }, { key: 'b', label: '2. widget', choices: CH }, { key: 'c', label: '3. widget', choices: CH }, { key: 'd', label: '4. widget', choices: CH },
                       { key: 'every', label: 'Geçiş süresi', choices: [['5', '5 sn'], ['8', '8 sn'], ['15', '15 sn'], ['30', '30 sn']] }],
                defaults: { a: 'nextup', b: 'weather', c: 'fx', d: 'none', every: '8' } },
    gitea:    { name: 'Gitea (commit + CI)', cat: 'Araçlar', icon: 'branch', def: 1, sizes: [['M', 4, 3], ['L', 6, 3], ['XL', 8, 6]] },
    pushvals: { name: 'Gönderilen değerler', cat: 'Araçlar', icon: 'mail', def: 0, sizes: [['S', 3, 2], ['M', 6, 3], ['L', 8, 3]] },
    services: { name: 'Servis kontrolü', cat: 'Ağ', icon: 'pulse', def: 0, sizes: [['M', 4, 3], ['L', 6, 3], ['XL', 8, 6]] },
    nowplaying: { name: 'Çalıyor (müzik)', cat: 'Araçlar', icon: 'music', def: 0, sizes: [['M', 4, 3], ['L', 6, 3], ['XL', 12, 6]] },
    health:   { name: 'Sağlık özeti', cat: 'Sistem', icon: 'heart', def: 0, sizes: [['M', 4, 3], ['L', 6, 3], ['XL', 6, 6]] },
    notify:   { name: 'Bildirimler', cat: 'Araçlar', icon: 'bell', def: 0, sizes: [['S', 4, 3], ['L', 6, 3], ['XL', 8, 6]] }
  };
  var CAT_ORDER = ['Zaman', 'Ev', 'Sistem', 'Ağ', 'AI', 'Piyasa', 'Haber', 'Araçlar'];

  // ---------- widget'lar ----------
  var widgets = {};

  // Saat: dijital (her saniye yeniden çizilir), analog ve animasyonlu (DOM bir kez kurulur, sonra yalnızca güncellenir ki CSS geçişleri çalışsın)
  function clockDate(d) { return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + DAYS[d.getDay()]; }

  function buildAnalog(el) {
    var ticks = '', i, a, major, r1, r2, c, sn;
    for (i = 0; i < 60; i++) {
      major = i % 5 === 0; a = i * Math.PI / 30; r1 = major ? 40 : 44; r2 = 47; c = Math.cos(a); sn = Math.sin(a);
      ticks += '<line x1="' + (50 + r1 * sn).toFixed(2) + '" y1="' + (50 - r1 * c).toFixed(2) + '" x2="' + (50 + r2 * sn).toFixed(2) + '" y2="' + (50 - r2 * c).toFixed(2) +
        '" stroke="' + (major ? '#e8ebff' : 'rgba(255,255,255,.28)') + '" stroke-width="' + (major ? 1.6 : 0.7) + '" stroke-linecap="round"/>';
    }
    var nums = '';
    for (i = 1; i <= 12; i++) {
      a = i * Math.PI / 6;
      nums += '<text x="' + (50 + 31 * Math.sin(a)).toFixed(2) + '" y="' + (50 - 31 * Math.cos(a)).toFixed(2) + '" class="an-n" text-anchor="middle" dominant-baseline="central">' + i + '</text>';
    }
    el.innerHTML = '<div class="grow clk-an"><svg viewBox="0 0 100 100" class="an-svg">' +
      '<circle cx="50" cy="50" r="48.5" fill="rgba(255,255,255,.04)" stroke="rgba(255,255,255,.14)" stroke-width="1"/>' + ticks + nums +
      '<line class="an-h an-hr" x1="50" y1="50" x2="50" y2="29" stroke="#e8ebff" stroke-width="3.4" stroke-linecap="round"/>' +
      '<line class="an-h an-mn" x1="50" y1="50" x2="50" y2="17" stroke="#e8ebff" stroke-width="2.2" stroke-linecap="round"/>' +
      '<line class="an-h an-sc" x1="50" y1="58" x2="50" y2="13" stroke="#f87171" stroke-width="1" stroke-linecap="round"/>' +
      '<circle cx="50" cy="50" r="2.6" fill="#f87171"/></svg><div class="date"></div></div>';
  }

  function updateAnalog(el, d) {
    var root = el.querySelector('.clk-an'), sc = el.querySelector('.an-sc'), mn = el.querySelector('.an-mn'), hr = el.querySelector('.an-hr');
    var raw = d.getSeconds() * 6;
    // saniye ibresi: sarmada geri dönmesin diye tam tur sayısını biriktir
    if (el._lastRaw !== undefined && raw < el._lastRaw) el._turns = (el._turns || 0) + 1;
    el._lastRaw = raw;
    sc.style.transform = 'rotate(' + (raw + 360 * (el._turns || 0)) + 'deg)';
    mn.style.transform = 'rotate(' + ((d.getMinutes() + d.getSeconds() / 60) * 6) + 'deg)';
    hr.style.transform = 'rotate(' + (((d.getHours() % 12) + d.getMinutes() / 60) * 30) + 'deg)';
    root.querySelector('.date').textContent = clockDate(d);
    if (!el._anim) { el._anim = true; requestAnimationFrame(function () { sc.style.transition = 'transform 1s linear'; mn.style.transition = 'transform .6s ease-out'; hr.style.transition = 'transform .6s ease-out'; }); }
  }

  function buildAnimated(el) {
    el.innerHTML = '<div class="grow clk-nx"><div class="nx-time"><span class="nx-hh"></span><span class="nx-colon">:</span><span class="nx-mm"></span></div>' +
      '<div class="nx-bar"><i></i></div><div class="date"></div></div>';
  }

  function updateAnimated(el, d) {
    el.querySelector('.nx-hh').textContent = pad(d.getHours());
    el.querySelector('.nx-mm').textContent = pad(d.getMinutes());
    var bar = el.querySelector('.nx-bar i'), sec = d.getSeconds();
    // saniye çubuğu: dolarken yumuşak, başa dönerken anında
    bar.style.transition = sec === 0 ? 'none' : 'width 1s linear';
    bar.style.width = ((sec + 1) / 60 * 100) + '%';
    el.querySelector('.date').textContent = clockDate(d);
  }

  widgets.clock = {
    deps: [], tick: true,
    render: function (el, opts) {
      var d = new Date(), style = (opts && opts.style) || 'digital';
      if (style === 'analog' || style === 'animated') {
        if (el.getAttribute('data-clock') !== style) {
          el._anim = false; el._lastRaw = undefined; el._turns = 0;
          (style === 'analog' ? buildAnalog : buildAnimated)(el);
          el.setAttribute('data-clock', style);
        }
        (style === 'analog' ? updateAnalog : updateAnimated)(el, d);
        return;
      }
      el.removeAttribute('data-clock');
      el.innerHTML = '<div class="grow clock" style="display:flex;flex-direction:column;justify-content:center">' +
        '<div class="time">' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + '<span class="sec">' + pad(d.getSeconds()) + '</span></div>' +
        '<div class="date">' + clockDate(d) + '</div></div>';
    }
  };

  // Takvim (Home Assistant'tan; ajanda görünümü): gün başlıkları, saat/“Tüm gün”, takvim rengi, devam eden etkinlik vurgulu
  var CAL_COLORS = ['#7c8cff', '#f9a8d4', '#34d399', '#fbbf24', '#7dd3fc', '#fb923c'];
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function localDate(str) { var p = String(str).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function calDayLabel(key, todayKey, todayD) {
    if (key === todayKey) return 'Bugün';
    var d = localDate(key), diff = Math.round((d - todayD) / 86400000);
    if (diff === 1) return 'Yarın';
    return DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
  }

  widgets.calendar = {
    deps: ['calendar'], tick: true,
    render: function (el, opts, def) {
      var c = S.calendar && S.calendar.data;
      // saniyelik tick'te her seferinde DOM'u kurma: 30 sn'de bir ya da veri/boyut/ayar değişince
      var stamp = Math.floor(Date.now() / 30000) + '|' + (S.calendar ? S.calendar.ts : 0) + '|' + def.w + 'x' + def.h + '|' + (el.clientHeight || 0);
      if (el._calStamp === stamp && el.firstChild) return;
      el._calStamp = stamp;
      if (!c) { el.innerHTML = '<div class="title">Takvim</div><div class="hint">Takvim bağlı değil. Home Assistant adresini ve jetonunu (<b>HA_URL</b>, <b>HA_TOKEN</b>) sunucunun .env dosyasına ekle.</div>'; return; }
      var now = Date.now(), todayD = new Date(); todayD = new Date(todayD.getFullYear(), todayD.getMonth(), todayD.getDate());
      var todayMs = todayD.getTime(), todayKey = ymd(todayD), items = [], colorOf = {}, i;
      for (i = 0; i < c.calendars.length; i++) colorOf[c.calendars[i].id] = CAL_COLORS[i % CAL_COLORS.length];
      c.events.forEach(function (e) {
        var it = { e: e, key: '', time: '', ongoing: false, sort: 0, extra: '' };
        if (e.allDay) {
          var from = localDate(e.date), to = localDate(e.endDate);
          if (to.getTime() <= todayMs) return;                       // bitti
          it.key = from.getTime() < todayMs ? todayKey : e.date;
          it.time = 'Tüm gün'; it.sort = -1;
          var days = Math.round((to - from) / 86400000);
          if (days > 1) it.extra = days + ' gün';
          it.ongoing = false;
        } else {
          if ((e.end > e.start ? e.end : e.start + 1) <= now) return; // bitti
          it.key = ymd(new Date(Math.max(e.start, todayMs)));
          var sd = new Date(e.start);
          it.time = pad(sd.getHours()) + ':' + pad(sd.getMinutes());
          it.sort = e.start; it.ongoing = e.start <= now;
        }
        items.push(it);
      });
      items.sort(function (a, b) { return a.key < b.key ? -1 : a.key > b.key ? 1 : a.sort - b.sort; });

      // üst satır: şu an / sıradaki
      var nextLine = '';
      for (i = 0; i < items.length; i++) {
        if (items[i].ongoing) { nextLine = '<b>Şu an:</b> ' + esc(items[i].e.title); break; }
      }
      if (!nextLine) {
        for (i = 0; i < items.length; i++) {
          if (!items[i].e.allDay && !items[i].ongoing) { nextLine = '<b>Sıradaki:</b> ' + esc(items[i].e.title) + ' · ' + fmtDur((items[i].e.start - now) / 60000) + ' sonra'; break; }
        }
      }

      // Hepsini çiz (en çok 40 satır), sonra kartın gerçek yüksekliğine sığana kadar sondan kırp
      var html = '', lastKey = '', rows = 0;
      for (i = 0; i < items.length && rows < 40; i++) {
        if (items[i].key !== lastKey) { html += '<div class="cal-d">' + calDayLabel(items[i].key, todayKey, todayD) + '</div>'; lastKey = items[i].key; }
        var ev = items[i].e;
        html += '<div class="cal-e' + (items[i].ongoing ? ' on' : '') + '"><i style="background:' + (colorOf[ev.cal] || '#94a3b8') + '"></i>' +
          '<span class="cal-t">' + items[i].time + '</span><span class="cal-n">' + esc(ev.title) +
          (items[i].extra || ev.location ? '<small>' + esc([items[i].extra, ev.location].filter(Boolean).join(' · ')) + '</small>' : '') + '</span></div>';
        rows++;
      }
      if (!items.length) html = '<div class="hint">Önümüzdeki günlerde etkinlik yok.</div>';
      el.innerHTML = '<div class="title">Takvim</div>' + (nextLine ? '<div class="cal-next">' + nextLine + '</div>' : '') +
        '<div class="cal-list">' + html + '</div><div class="cal-more"></div>' +
        (c.failed && c.failed.length ? '<div class="cal-warn">' + Icons.ic('warn') + ' ' + c.failed.length + ' takvim okunamadı</div>' : '');
      var list = el.querySelector('.cal-list');
      while (list.scrollHeight > list.clientHeight + 1 && list.lastElementChild) list.removeChild(list.lastElementChild);
      while (list.lastElementChild && list.lastElementChild.className === 'cal-d') list.removeChild(list.lastElementChild); // altında etkinliği kalmayan gün başlığı
      var more = items.length ? items.length - list.querySelectorAll('.cal-e').length : 0;
      if (more > 0) el.querySelector('.cal-more').textContent = '+' + more + ' etkinlik daha';
    }
  };

  // ---- Home Assistant cihazları (yalnız okuma) ----
  function haGate(el, title, key, emptyHint) {
    var h = S.ha && S.ha.data;
    if (!h) { el.innerHTML = '<div class="title">' + title + '</div><div class="hint">Home Assistant bağlı değil. Sunucunun .env dosyasına <b>HA_URL</b> ve <b>HA_TOKEN</b> ekle.</div>'; return null; }
    if (!h[key] || !h[key].length) { el.innerHTML = '<div class="title">' + title + '</div><div class="hint">' + emptyHint + '</div>'; return null; }
    return h[key];
  }

  widgets.ha_air = {
    deps: ['ha'],
    render: function (el, opts, def) {
      var fans = haGate(el, 'Hava temizleyici', 'fans', 'Home Assistant’ta hava temizleyici (fan) bulunamadı.');
      if (!fans) return;
      var compact = def.w < 4, html = '', n = def.w >= 6 ? 2 : 1;
      for (var i = 0; i < fans.length && i < n; i++) {
        var f = fans[i], sn = f.sensors, lv = SkyMath.pm25(sn.pm25), state = f.unavailable ? 'Çevrimdışı' : f.on ? 'Açık' : 'Kapalı';
        var stats = '';
        if (!compact) {
          if (sn.humidity !== null) stats += '<div><span>Nem</span><b>' + Math.round(sn.humidity) + '%</b></div>';
          if (sn.temperature !== null) stats += '<div><span>Sıcaklık</span><b>' + sn.temperature.toFixed(1) + '°</b></div>';
          if (f.on && sn.rpm !== null) stats += '<div><span>Fan</span><b>' + Math.round(sn.rpm) + ' rpm</b></div>';
          else if (f.on && f.percentage !== null) stats += '<div><span>Fan</span><b>%' + Math.round(f.percentage) + '</b></div>';
          if (f.mode) stats += '<div><span>Mod</span><b>' + esc(f.mode) + '</b></div>';
        }
        var filter = '';
        if (sn.filterLeft !== null) {
          var fl = Math.max(0, Math.min(100, sn.filterLeft)), dead = fl <= 10;
          filter = '<div class="ha-filter' + (dead ? ' dead' : '') + '"><div class="ha-fl"><span>' + (dead ? Icons.ic('warn') + ' Filtre bitti, değiştir' : 'Filtre') + '</span><b>%' + Math.round(fl) + '</b></div>' +
            '<div class="mbar"><div style="width:' + Math.max(fl, 2) + '%;background:' + (dead ? '#f87171' : fl < 30 ? '#fbbf24' : '#34d399') + '"></div></div>' +
            (dead && sn.filterHours !== null && !compact ? '<small>' + Math.round(sn.filterHours) + ' saat kullanıldı</small>' : '') + '</div>';
        }
        html += '<div class="ha-dev"><div class="ha-top"><span class="ha-st ' + (f.on ? 'on' : '') + '">' + state + '</span></div>' +
          (sn.pm25 !== null ? '<div class="ha-pm"><b style="color:' + (lv ? lv.color : 'var(--fg)') + '">' + Math.round(sn.pm25) + '</b><div><small>PM2.5 µg/m³</small><span style="color:' + (lv ? lv.color : 'var(--dim)') + '">' + (lv ? lv.label : '') + '</span></div></div>' : '') +
          (stats ? '<div class="ha-stats">' + stats + '</div>' : '') + filter + '</div>';
      }
      el.innerHTML = '<div class="title">Hava temizleyici</div><div class="ha-devs">' + html + '</div>';
    }
  };

  var VAC_STATE = { cleaning: ['Temizliyor', 'on'], docked: ['İstasyonda', ''], charging: ['Şarj oluyor', ''], returning: ['İstasyona dönüyor', 'on'], paused: ['Duraklatıldı', 'warn'], idle: ['Boşta', ''], error: ['Hata', 'bad'] };
  widgets.ha_vac = {
    deps: ['ha'],
    render: function (el, opts, def) {
      var vs = haGate(el, 'Robot süpürge', 'vacuums', 'Home Assistant’ta robot süpürge bulunamadı. Entegrasyon eklenince burada görünür.');
      if (!vs) return;
      var html = '', n = def.w >= 6 ? 2 : 1;
      for (var i = 0; i < vs.length && i < n; i++) {
        var v = vs[i], st = VAC_STATE[v.state] || [v.state, ''], b = v.battery;
        html += '<div class="ha-dev"><div class="ha-vs ' + st[1] + '">' + st[0] + '</div>' +
          (v.status && v.status !== v.state ? '<div class="ha-sub">' + esc(v.status) + '</div>' : '') +
          (b !== null ? '<div class="ha-filter"><div class="ha-fl"><span>Pil</span><b>%' + Math.round(b) + '</b></div><div class="mbar"><div style="width:' + Math.max(b, 2) + '%;background:' + (b < 20 ? '#f87171' : b < 50 ? '#fbbf24' : '#34d399') + '"></div></div></div>' : '') +
          (v.fanSpeed && def.w >= 4 ? '<div class="ha-sub">Emiş: ' + esc(v.fanSpeed) + '</div>' : '') + '</div>';
      }
      el.innerHTML = '<div class="title">Robot süpürge</div><div class="ha-devs">' + html + '</div>';
    }
  };

  var CLIM_ACT = { heating: [Icons.ic('flame') + ' Isıtıyor', 'on'], cooling: [Icons.ic('snow') + ' Soğutuyor', 'cool'], idle: ['Bekliyor', ''], off: ['Kapalı', ''], drying: ['Nem alıyor', ''], fan: ['Fan', ''] };
  var CLIM_MODE = { heat: 'Isıtma açık', off: 'Kapalı', auto: 'Otomatik', cool: 'Soğutma', heat_cool: 'Isıt/Soğut', dry: 'Nem alma', fan_only: 'Fan' };
  var CLIM_PRESET = { home: 'Evde', sleep: 'Uyku', away: 'Dışarıda', custom: 'Özel', auto: 'Otomatik', schedule: 'Program', eco: 'Eko', comfort: 'Konfor', boost: 'Hızlı' };
  widgets.ha_clim = {
    deps: ['ha'],
    render: function (el, opts, def) {
      var cs = haGate(el, 'Kombi / termostat', 'climates', 'Home Assistant’ta kombi/termostat (climate) ya da sıcak su (water_heater) bulunamadı. Entegrasyon eklenince burada görünür.');
      if (!cs) return;
      var html = '', n = def.w >= 6 ? 3 : def.w >= 4 ? 2 : 1;
      for (var i = 0; i < cs.length && i < n; i++) {
        var c = cs[i], act = CLIM_ACT[c.action || ''] || [CLIM_MODE[c.mode] || c.mode, ''];
        if (!c.action && c.mode === 'off') act = ['Kapalı', ''];
        var meta = [];
        if (c.humidity !== null && c.humidity !== undefined) meta.push('Nem %' + Math.round(c.humidity));
        if (c.preset) meta.push(CLIM_PRESET[c.preset] || c.preset);
        html += '<div class="ha-dev"><div class="ha-cn">' + esc(c.name || (c.kind === 'water' ? 'Sıcak su' : 'Kombi')) + '</div>' +
          '<div class="ha-ct">' + (c.current !== null ? c.current.toFixed(1).replace(/\.0$/, '') + '°' : '—') + '</div>' +
          '<div class="ha-sub">' + (c.target !== null ? 'Hedef ' + c.target.toFixed(1).replace(/\.0$/, '') + '°' : (c.mode === 'off' ? 'Hedef yok (kapalı)' : '')) + '</div>' +
          '<div class="ha-act ' + act[1] + '">' + (c.kind === 'water' && !c.action ? (c.mode === 'off' ? 'Kapalı' : 'Açık') : act[0]) + '</div>' +
          (meta.length && def.w >= 4 ? '<div class="ha-sub">' + esc(meta.join(' · ')) + '</div>' : '') + '</div>';
      }
      el.innerHTML = '<div class="title">Kombi / termostat</div><div class="ha-devs">' + html + '</div>';
    }
  };

  widgets.weather = {
    deps: ['weather'],
    render: function (el) {
      var w = S.weather && S.weather.data;
      if (!w) { el.innerHTML = '<div class="title">Hava</div><div class="dim">veri yok</div>'; return; }
      var days = '';
      for (var i = 1; i < w.days.length && i < 5; i++) {
        var d = w.days[i], dt = new Date(d.date + 'T12:00:00');
        days += '<div class="wx-d"><b>' + DAYS_S[dt.getDay()] + '</b><span>' + wxIcon(d.code) + '</span>' + Math.round(d.max) + '° / ' + Math.round(d.min) + '°</div>';
      }
      el.innerHTML = '<div class="title">Hava · ' + esc(w.city) + '</div>' +
        '<div class="wx-now"><div class="wx-ico">' + wxIcon(w.code) + '</div><div><div class="wx-t">' + Math.round(w.temp) + '°</div>' +
        '<div class="wx-sub">Hissedilen ' + Math.round(w.feels) + '° · Bugün ' + Math.round(w.days[0].max) + '° / ' + Math.round(w.days[0].min) + '°</div></div></div>' +
        '<div class="wx-days">' + days + '</div>';
    }
  };

  widgets.forecast = {
    deps: ['weather'],
    render: function (el, opts, def) {
      var w = S.weather && S.weather.data;
      if (!w) { el.innerHTML = '<div class="title">Tahmin</div><div class="dim">veri yok</div>'; return; }
      var daily = opts && opts.mode === 'daily', cols = '', i;
      if (daily) {
        var nd = Math.min(w.days.length, def.w >= 12 ? 7 : def.w >= 8 ? 6 : 5);
        for (i = 0; i < nd; i++) {
          var d = w.days[i], dt = new Date(d.date + 'T12:00:00');
          cols += '<div class="fc"><b>' + (i === 0 ? 'Bugün' : DAYS_S[dt.getDay()]) + '</b><span class="fc-i">' + wxIcon(d.code) + '</span>' +
            '<em>' + Math.round(d.max) + '°</em><small>' + Math.round(d.min) + '°</small>' +
            (d.pop ? '<small class="fc-p">' + Icons.ic('drop') + Math.round(d.pop) + '%</small>' : '<small class="fc-p"></small>') + '</div>';
        }
      } else {
        var hrs = w.hours || [], nh = Math.min(hrs.length, def.w >= 12 ? 14 : def.w >= 8 ? 10 : 7);
        if (!nh) { el.innerHTML = '<div class="title">Tahmin</div><div class="dim">saatlik veri yok</div>'; return; }
        for (i = 0; i < nh; i++) {
          var h = hrs[i];
          cols += '<div class="fc"><b>' + (i === 0 ? 'Şimdi' : String(h.time).slice(11, 13)) + '</b><span class="fc-i">' +
            wxIcon(h.code, !h.isDay) + '</span><em>' + Math.round(h.temp) + '°</em>' +
            (h.pop ? '<small class="fc-p">' + Icons.ic('drop') + Math.round(h.pop) + '%</small>' : '<small class="fc-p"></small>') + '</div>';
        }
      }
      el.innerHTML = '<div class="title">' + (daily ? '7 günlük tahmin' : 'Saatlik tahmin') + ' · ' + esc(w.city) + '</div><div class="fc-row">' + cols + '</div>';
    }
  };

  widgets.sky = {
    deps: ['weather', 'air'], tick: true,
    render: function (el, opts, def) {
      var w = S.weather && S.weather.data;
      if (!w || !w.days || !w.days.length) { el.innerHTML = '<div class="title">Güneş ve Ay</div><div class="dim">veri yok</div>'; return; }
      var now = Date.now(), d0 = w.days[0], sn = SkyMath.sun(d0, now, w.utcOffset), mn = SkyMath.moon(now);
      var uvv = d0.uv === null || d0.uv === undefined ? null : d0.uv, uvl = SkyMath.uv(uvv);
      var big = def.h >= 4;
      var arc = '', status = '';
      if (sn) {
        // yarim daire: x gunes ilerlemesine gore, y = sin
        var p = sn.progress, ang = Math.PI * (1 - p), cx = 50 + 40 * Math.cos(ang), cy = 52 - 38 * Math.sin(ang);
        arc = '<svg viewBox="0 0 100 60" class="sky-arc"><path d="M10 52 A40 38 0 0 1 90 52" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="1.6" stroke-dasharray="2 3"/>' +
          '<line x1="4" y1="52" x2="96" y2="52" stroke="rgba(255,255,255,.18)" stroke-width="1"/>' +
          (sn.state === 'day' ? '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="4.2" fill="#fbbf24"/>' : '') + '</svg>';
        status = sn.state === 'day' ? fmtDur(sn.leftMin) + ' gün ışığı kaldı'
          : sn.state === 'before' ? 'Gün doğumuna ' + fmtDur(sn.toRiseMin) : 'Gün battı';
      }
      var rise = String(d0.sunrise || '').slice(11, 16), set = String(d0.sunset || '').slice(11, 16);
      var moonTxt = mn.illum >= 0.97 ? 'Dolunay' : mn.illum <= 0.03 ? 'Yeni ay' : '%' + Math.round(mn.illum * 100) + ' aydınlık';
      var nextFull = Math.round(mn.daysToFull), nextTxt = nextFull <= 0 ? 'Dolunay bugün' : 'Dolunaya ' + nextFull + ' gün';
      el.innerHTML = '<div class="title">Güneş ve Ay · ' + esc(w.city) + '</div><div class="sky">' +
        '<div class="sky-sun">' + arc + '<div class="sky-times"><span>' + Icons.ic('sunrise') + ' ' + rise + '</span><span>' + Icons.ic('sunset') + ' ' + set + '</span></div>' +
        '<div class="sky-st">' + status + '</div></div>' +
        '<div class="sky-moon"><div class="sky-mi">' + mn.icon + '</div><div class="sky-mn">' + mn.name + '</div><div class="sky-ms">' + moonTxt + '</div>' +
        (big ? '<div class="sky-ms">' + nextTxt + '</div>' : '') + '</div>' +
        (uvl ? '<div class="sky-uv"><b style="color:' + uvl.color + '">UV ' + Math.round(uvv) + '</b><small>' + uvl.label + '</small></div>' : '') + '</div>';
    }
  };

  widgets.airq = {
    deps: ['air'],
    render: function (el, opts, def) {
      var a = S.air && S.air.data;
      if (!a || a.aqi === null || a.aqi === undefined) { el.innerHTML = '<div class="title">Hava kalitesi</div><div class="dim">veri yok</div>'; return; }
      var lv = SkyMath.aqi(a.aqi) || { label: '', color: '#94a3b8' };
      function pol(name, v) { return v === null || v === undefined ? '' : '<div class="aq-p"><span>' + name + '</span><b>' + Math.round(v) + '</b></div>'; }
      var showPol = def.w >= 4;
      el.innerHTML = '<div class="title">Hava kalitesi</div><div class="aq"><div class="aq-ring"><div class="ring-wrap">' +
        ringSVG(Math.min(100, a.aqi), Math.round(a.aqi), lv.color) + '</div><div class="aq-lv" style="color:' + lv.color + '">' + lv.label + '</div></div>' +
        (showPol ? '<div class="aq-pols">' + pol('PM2.5', a.pm25) + pol('PM10', a.pm10) + pol('Ozon', a.o3) + pol('NO₂', a.no2) + '<div class="aq-u">µg/m³ · AQI (AB)</div></div>' : '') + '</div>';
    }
  };

  widgets.ring = {
    deps: ['system'],
    render: function (el, opts) {
      var s = S.system && S.system.data, m = opts.metric || 'cpu', pct = 0, label = '—', name = '', sub = '';
      if (s) {
        if (m === 'cpu') { pct = s.cpu; label = Math.round(s.cpu) + '%'; name = 'CPU'; sub = s.cores + ' çekirdek · yük ' + s.load[0].toFixed(2); }
        if (m === 'ram') { pct = s.mem.used / s.mem.total * 100; label = Math.round(pct) + '%'; name = 'RAM'; sub = fmtBytes(s.mem.used) + ' / ' + fmtBytes(s.mem.total); }
        if (m === 'disk') { pct = s.disk.used / s.disk.total * 100; label = Math.round(pct) + '%'; name = 'Disk'; sub = fmtBytes(s.disk.used) + ' / ' + fmtBytes(s.disk.total); }
        if (m === 'temp') {
          name = 'Sıcaklık';
          if (s.temp === null || s.temp === undefined) { pct = 0; label = '—'; sub = 'sensör yok'; }
          else { pct = Math.min(100, s.temp); label = Math.round(s.temp) + '°'; sub = (s.tempSource ? 'sensör: ' + esc(s.tempSource) + ' · ' : '') + 'açık ' + fmtDur(s.uptime / 60); }
        }
      }
      el.innerHTML = '<div class="title">' + name + '</div><div class="ring-wrap">' + ringSVG(pct, label, colorFor(pct)) + '</div><div class="ring-lbl">' + sub + '</div>';
    }
  };

  widgets.cpugraph = {
    deps: ['system'],
    render: function (el) {
      var s = S.system && S.system.data;
      var cur = s ? Math.round(s.cpu) : 0;
      el.innerHTML = '<div class="title">CPU geçmişi</div><div class="n-head"><div class="n-v" style="color:#a5b4fc">' + cur + '<small>%</small></div></div>' +
        '<div class="chart">' + (s ? lineChart([s.hist.cpu], ['#818cf8'], 100) : '') + '</div>';
    }
  };

  widgets.network = {
    deps: ['system'],
    render: function (el, opts, def) {
      var s = S.system && S.system.data;
      if (!s) { el.innerHTML = '<div class="title">Ağ</div><div class="dim">veri yok</div>'; return; }
      el.className = 'wc' + (def.h < 4 ? ' compact' : '');
      el.innerHTML = '<div class="title">İnternet</div><div class="n-head">' +
        '<div class="n-v dn">↓ ' + fmtMbit(s.rx) + '<small>Mb/s</small></div>' +
        '<div class="n-v up">↑ ' + fmtMbit(s.tx) + '<small>Mb/s</small></div></div>' +
        '<div class="chart">' + lineChart([s.hist.rx, s.hist.tx], ['#7dd3fc', '#f9a8d4'], 10) + '</div>';
    }
  };

  // Evin ana internet sayacı: modemin UPnP sayaçları (tüm cihazların toplamı)
  widgets.modem = {
    deps: ['modem'],
    render: function (el, opts, def) {
      var m = S.modem && S.modem.data;
      if (!m) { el.innerHTML = '<div class="title">Ev interneti</div><div class="hint">Modemden veri gelmiyor. Modem arayüzünde <b>Yerel Ağ → UPnP</b> açık olmalı.</div>'; return; }
      el.className = 'wc' + (def.h < 4 ? ' compact' : '');
      var v = function (x) { return x === null || x === undefined ? '—' : fmtMbit(x); };
      el.innerHTML = '<div class="title">Ev interneti · modem <span class="dim">(30 sn ort.)</span></div><div class="n-head">' +
        '<div class="n-v dn">↓ ' + v(m.rx) + '<small>Mb/s</small></div>' +
        '<div class="n-v up">↑ ' + v(m.tx) + '<small>Mb/s</small></div></div>' +
        (def.h >= 3 ? '<div class="m-today">Bugün <b>↓ ' + fmtBytes(m.todayRx) + '</b> · <b>↑ ' + fmtBytes(m.todayTx) + '</b></div>' : '') +
        '<div class="chart">' + lineChart([m.hist.rx, m.hist.tx], ['#7dd3fc', '#f9a8d4'], 10) + '</div>';
    }
  };


  widgets.docker = {
    deps: ['docker'],
    render: function (el) {
      var d = S.docker && S.docker.data;
      if (!d) { el.innerHTML = '<div class="title">Docker</div><div class="dim">veri yok</div>'; return; }
      var list = d.containers.slice().sort(function (a, b) {
        var ar = a.state === 'running' ? 1 : 0, br = b.state === 'running' ? 1 : 0;
        return ar - br || (a.name < b.name ? -1 : 1);
      });
      var run = 0, i, rows = '';
      for (i = 0; i < list.length; i++) if (list[i].state === 'running') run++;
      for (i = 0; i < list.length; i++) rows += '<div class="d-row' + (list[i].state === 'running' ? '' : ' off') + '"><i></i><span>' + esc(list[i].name) + '</span></div>';
      el.innerHTML = '<div class="title">Docker</div><div class="d-sum">' + run + '<small>/ ' + list.length + ' çalışıyor</small></div><div class="d-list">' + rows + '</div>';
    }
  };

  var MODEL_NAMES = { fable: 'Fable', sonnet: 'Sonnet', opus: 'Opus' };

  widgets.quota = {
    deps: ['quotas'], tick: true,
    render: function (el, opts, def) {
      var q = S.quotas && S.quotas.data, compact = def.h < 4, now = Date.now();
      if (!q) { el.innerHTML = '<div class="title">AI kotaları</div><div class="dim">veri yok</div>'; return; }
      var provs = q.providers || [], want = opts && opts.provider && opts.provider !== 'all' ? opts.provider : null;
      if (want) provs = provs.filter(function (p) { return p.id === want; });
      if (!provs.length) {
        el.innerHTML = '<div class="title">AI kotaları</div><div class="hint">' + (want
          ? 'Bu ajan için henüz kota verisi yok. Düzenleme modunda kartın ayarından başka bir ajan seçebilirsin.'
          : 'Henüz kota verisi yok. <b>Claude</b> kotası sunucudaki Claude Code’dan, <b>Codex</b> kullanılınca kendiliğinden gelir. İstemezsen düzenleme modunda bu kartı kaldırabilirsin.') + '</div>';
        return;
      }
      var stack = def.h >= 5 && provs.length > 1;
      var html = '<div class="title">AI kotaları</div><div class="q-grid' + (stack ? ' stack' : '') + '">';
      for (var i = 0; i < provs.length; i++) {
        var p = provs[i], ms = '', age = QuotaMath.age(p.observedAt, now), lims = p.limits, modelNote = '';
        // Model-özel haftalık satırlar "Hafta · <Model>" etiketiyle gelir; seçime göre süz. Genel satırlar (Oturum, Hafta) hep kalır.
        if (opts && opts.model && opts.model !== 'all' && p.id === 'claude') {
          var mHit = false;
          lims = lims.filter(function (x) {
            var m = /^Hafta · (.+)$/.exec(x.label);
            if (!m) return true;
            if (opts.model !== 'none' && m[1].toLowerCase() === opts.model) { mHit = true; return true; }
            return false;
          });
          if (opts.model !== 'none' && !mHit) modelNote = MODEL_NAMES[opts.model] + ' için ayrı limit yok; genel haftalık sayaca dahil';
        }
        for (var j = 0; j < lims.length; j++) {
          var l = lims[j], v = QuotaMath.view(l, now), ring, sub, note = '', warn = false, dim = false;
          if (v.expired) {
            // Pencere sıfırlandı: eldeki yüzde artık geçersiz, uydurma bir değer gösterme
            ring = ringSVG(0, '—', '#475076'); sub = 'pencere sıfırlandı'; note = 'yeni veri bekleniyor'; dim = true;
          } else {
            ring = ringSVG(v.pct, Math.round(v.pct) + '%', colorFor(v.pct));
            sub = v.resetMin === null ? '' : fmtDur(v.resetMin) + ' sonra sıfırlanır';
            if (v.pace) {
              if (v.pace.kind === 'full') { note = 'Bu hızla ' + fmtDur(v.pace.minutes) + ' içinde dolar'; warn = true; }
              else if (v.pace.kind === 'done') { note = 'Limit doldu'; warn = true; }
              else if (v.pace.kind === 'low') note = 'Bol';
              else note = 'Tempoda';
            }
          }
          ms += '<div class="q-m"><div class="ring-wrap">' + ring + '</div><div class="l">' + esc(l.label) + '</div>' +
            '<div class="r">' + sub + '</div>' + (compact ? '' : '<div class="n' + (warn ? ' warn' : dim ? ' dim' : '') + '">' + note + '</div>') + '</div>';
        }
        if (!lims.length) ms = '<div class="hint">ölçüm yok</div>';
        html += '<div class="q-prov' + (lims.length === 1 ? ' p2' : '') + '"><div class="q-head"><span class="q-name">' + esc(p.name) + '</span>' +
          (p.plan ? '<span class="q-plan">' + esc(p.plan) + '</span>' : '') +
          '<span class="q-age' + (age.stale ? ' stale' : '') + '">' + age.text + '</span></div><div class="q-meters">' + ms + '</div>' +
          (modelNote ? '<div class="q-mnote">' + esc(modelNote) + '</div>' : '') + '</div>';
      }
      el.innerHTML = html + '</div>';
    }
  };

  // Claude Code'un İngilizce bildirim metinlerini Türkçeleştir
  function trMsg(m) {
    m = String(m || '');
    var r;
    if ((r = /^(?:Claude|Codex|Antigravity) needs your permission to use (.+?)\.?$/i.exec(m))) return r[1] + ' için izin bekliyor';
    if (/^(?:Claude|Codex|Antigravity) is waiting for your input\.?$/i.test(m)) return 'Yanıtını bekliyor';
    if (/^(?:Claude|Codex|Antigravity) needs your attention\.?$/i.test(m)) return 'Senden bir şey bekliyor';
    return m;
  }

  widgets.sessions = {
    deps: ['sessions'], tick: true,
    render: function (el) {
      var s = S.sessions && S.sessions.data;
      if (!s) { el.innerHTML = '<div class="title">AI işleri</div><div class="dim">veri yok</div>'; return; }
      var order = { waiting: 0, working: 1, idle: 2 };
      var list = s.sessions.slice().sort(function (a, b) { return order[a.state] - order[b.state] || a.since - b.since; });
      var counts = { working: 0, waiting: 0, idle: 0 }, rows = '';
      for (var i = 0; i < list.length; i++) {
        var x = list[i]; counts[x.state]++;
        // alt satir: bekliyorsa ne istedigi, calisiyorsa hangi arac, yoksa oturumun ilk istemi
        var sub = x.state === 'waiting' && x.message ? trMsg(x.message) : (x.state === 'working' && x.tool ? 'şu an: ' + x.tool : x.title || '');
        var secs = Math.max(0, (Date.now() - x.since) / 1000);
        rows += '<div class="s-row ' + x.state + '"><span class="s-dot"></span><span class="s-ag ag-' + esc(x.agent) + '">' + esc(x.agent) + '</span>' +
          '<span class="s-name">' + esc(x.project || '?') + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span>' +
          (x.host ? '<span class="s-host">' + esc(x.host) + '</span>' : '') +
          '<span class="s-time">' + (secs < 60 ? Math.round(secs) + 'sn' : fmtDur(secs / 60)) + '</span></div>';
      }
      if (!rows) rows = '<div class="hint" style="grid-column:1 / -1">Henüz oturum yok. Makinelerde Claude Code kancalarını kur: <b>node hooks/install-hooks.mjs</b></div>';
      el.innerHTML = '<div class="title">AI işleri · ' + counts.working + ' çalışıyor · ' + counts.waiting + ' bekliyor · ' + counts.idle + ' boşta</div><div class="s-list">' + rows + '</div>';
    }
  };

  widgets.machines = {
    deps: ['machines'],
    render: function (el, opts, def) {
      var m = S.machines && S.machines.data;
      if (!m) { el.innerHTML = '<div class="title">Makineler</div><div class="dim">veri yok</div>'; return; }
      var tall = def && def.h >= 6;
      var order = opts.order || ['laptop', 'desktop', 'server'];
      var ids = Object.keys(m.hosts);
      ids.sort(function (a, b) {
        var ia = order.indexOf(a), ib = order.indexOf(b);
        if (ia < 0) ia = 99; if (ib < 0) ib = 99;
        return ia - ib || (a < b ? -1 : 1);
      });
      var cols = '';
      ids.forEach(function (id) {
        var h = m.hosts[id], on = h.online && h.mem;
        if (!on) {
          cols += '<div class="mc off"><div class="mh"><i class="od"></i><b>' + esc(h.label || id) + '</b></div>' +
            '<div class="m-off">çevrimdışı' + (h.seen ? '<small>son görülme ' + fmtDur((Date.now() - h.seen) / 60000) + ' önce</small>' : '<small>henüz bağlanmadı</small>') + '</div></div>';
          return;
        }
        var ramPct = h.mem.total ? h.mem.used / h.mem.total * 100 : 0;
        var disks = '';
        for (var i = 0; i < h.disks.length; i++) {
          var d = h.disks[i], p = d.total ? d.used / d.total * 100 : 0;
          disks += '<div class="md"><div class="mdl"><span>' + (d.usb ? '<i class="usb" title="harici disk">' + Icons.ic('plug') + '</i> ' : '') + esc(d.name) + '</span><span>' + Math.round(p) + '% · ' + fmtBytes(d.total) + '</span></div>' +
            '<div class="mbar"><div style="width:' + p.toFixed(1) + '%;background:' + colorFor(p) + '"></div></div></div>';
        }
        // pil (varsa)
        var bat = '';
        if (h.battery) {
          var bp = h.battery.pct, low = bp <= 20 && !h.battery.plugged;
          bat = '<span class="m-bat' + (low ? ' low' : '') + '">' + Icons.ic(h.battery.charging ? 'bolt' : h.battery.plugged ? 'plug' : 'battery') + ' ' + Math.round(bp) + '%</span>';
        }
        // halkalar: CPU, RAM ve (varsa) GPU
        var g = h.gpus && h.gpus.length ? h.gpus[0] : null, rings =
          '<div class="mrw"><div class="ring-wrap">' + ringSVG(h.cpu, Math.round(h.cpu) + '%', colorFor(h.cpu)) + '</div><div class="ring-lbl">CPU' + (h.temp ? ' ' + Math.round(h.temp) + '°' : '') + '</div></div>' +
          '<div class="mrw"><div class="ring-wrap">' + ringSVG(ramPct, Math.round(ramPct) + '%', colorFor(ramPct)) + '</div><div class="ring-lbl">RAM ' + fmtBytes(h.mem.used) + '</div></div>';
        var gline = '';
        if (g && g.util !== null) {
          rings += '<div class="mrw"><div class="ring-wrap">' + ringSVG(g.util, Math.round(g.util) + '%', colorFor(g.util)) + '</div><div class="ring-lbl">GPU' + (g.temp !== null ? ' ' + Math.round(g.temp) + '°' : '') + '</div></div>';
          var bits = [esc(g.name)];
          if (g.memTotal) bits.push('VRAM ' + ((g.memUsed || 0) / 1073741824).toFixed(1) + '/' + (g.memTotal / 1073741824).toFixed(0) + ' GB');
          if (g.power !== null) bits.push(Math.round(g.power) + ' W');
          gline = '<div class="m-gpu">' + bits.join(' · ') + '</div>';
        }
        // en çok RAM kullananlar (yalnızca uzun kartta)
        var procs = '';
        if (tall && h.procs && h.procs.length) {
          var pmax = h.procs[0].mem || 1;
          procs = '<div class="m-procs"><div class="m-ph">En çok RAM</div>';
          for (var k = 0; k < h.procs.length && k < 5; k++) {
            var pr = h.procs[k];
            procs += '<div class="m-pr"><span class="m-pn">' + esc(pr.name) + '</span><span class="m-pv">' + fmtBytes(pr.mem) + '</span><div class="m-pb"><div style="width:' + (pr.mem / pmax * 100).toFixed(0) + '%"></div></div></div>';
          }
          procs += '</div>';
        }
        cols += '<div class="mc"><div class="mh"><i class="od on"></i><b>' + esc(h.label) + '</b>' + bat + '<span>' + esc(h.os) + ' · ' + fmtDur(h.uptime / 60) + '</span></div>' +
          '<div class="mr">' + rings + '</div>' + gline +
          '<div class="mdisks">' + disks + '</div>' + procs +
          '<div class="mn"><div class="n-head"><div class="n-v dn">↓ ' + fmtMbit(h.rx) + '<small>Mb/s</small></div><div class="n-v up">↑ ' + fmtMbit(h.tx) + '<small>Mb/s</small></div></div>' +
          '<div class="chart">' + lineChart([h.hist.rx, h.hist.tx], ['#7dd3fc', '#f9a8d4'], 5) + '</div></div></div>';
      });
      el.innerHTML = '<div class="mcols">' + cols + '</div>';
    }
  };

  // ---- Araclar: Gitea, webhook ile gelen degerler ve bildirimler ----
  var CI_LABEL = { success: 'CI ✓', failure: 'CI ✗', pending: 'CI …', none: '' };
  widgets.gitea = {
    deps: ['gitea'], tick: true,
    render: function (el, opts, def) {
      var g = S.gitea && S.gitea.data;
      if (!g) { el.innerHTML = '<div class="title">Gitea</div><div class="dim">' + (S.gitea && S.gitea.error ? esc(S.gitea.error) : 'veri yok (GITEA_TOKEN?)') + '</div>'; return; }
      var per = def.h >= 5 ? 5 : def.w >= 6 ? 2 : 1, html = '';
      g.repos.forEach(function (r) {
        var rows = '';
        if (r.error) rows = '<div class="dim">' + esc(r.error) + '</div>';
        r.commits.slice(0, per).forEach(function (c) {
          rows += '<div class="gt-c"><code>' + esc(c.sha) + '</code><span class="gt-m">' + esc(c.msg) + '</span><span class="gt-a">' + (c.ts ? fmtDur((Date.now() - c.ts) / 60000) + ' önce' : '') + '</span></div>';
        });
        html += '<div class="gt-r"><div class="gt-n">' + esc(r.short) + (CI_LABEL[r.ci] ? '<span class="ci ' + r.ci + '">' + CI_LABEL[r.ci] + '</span>' : '') + '</div>' + rows + '</div>';
      });
      el.innerHTML = '<div class="title">Gitea</div><div class="gt">' + html + '</div>';
    }
  };

  widgets.pushvals = {
    deps: ['push'], tick: true,
    render: function (el) {
      var p = S.push && S.push.data, v = p ? p.values : [];
      if (!v.length) { el.innerHTML = '<div class="title">Gönderilen değerler</div><div class="hint">Henüz değer yok. <b>POST /api/push</b> ile <code>{"id","label","value","unit"}</code> gönder.</div>'; return; }
      var tiles = '';
      v.forEach(function (x) {
        var val = typeof x.value === 'number' ? (Math.abs(x.value) >= 100 ? x.value.toFixed(0) : String(+x.value.toFixed(2))) : esc(x.value);
        tiles += '<div class="pv ' + esc(x.level) + '"><div class="pv-l">' + esc(x.label) + '</div><div class="pv-v">' + val + (x.unit ? '<small>' + esc(x.unit) + '</small>' : '') + '</div>' +
          '<div class="pv-s">' + (x.sub ? esc(x.sub) : fmtDur((Date.now() - x.ts) / 60000) + ' önce') + '</div></div>';
      });
      el.innerHTML = '<div class="title">Gönderilen değerler</div><div class="pvs">' + tiles + '</div>';
    }
  };

  // ---- Saglik ozeti: yuk, disk, bellek, sicaklik, konteyner, makine ----
  widgets.health = {
    deps: ['system', 'docker', 'machines', 'services'],
    render: function (el, opts, def) {
      var inp = { system: S.system && S.system.data, docker: S.docker && S.docker.data, machines: S.machines && S.machines.data, services: S.services && S.services.data };
      if (!inp.system && !inp.docker && !inp.machines) { el.innerHTML = '<div class="title">Sağlık özeti</div><div class="dim">veri yok</div>'; return; }
      var r = HealthMath.evaluate(inp), n = 0, i;
      for (i = 0; i < r.checks.length; i++) if (r.checks[i].level) n++;
      var cls = ['ok', 'warn', 'bad'][r.level];
      var head = r.level === 0 ? 'Her şey yolunda' : r.level === 1 ? n + ' uyarı' : n + ' sorun';
      var list = r.checks.slice().sort(function (a, b) { return b.level - a.level; });
      var max = def && def.h >= 5 ? 8 : 5, rows = '';
      for (i = 0; i < list.length && i < max; i++) {
        var c = list[i];
        rows += '<div class="hl ' + ['ok', 'warn', 'bad'][c.level] + '"><i></i><span class="hl-n">' + esc(c.label) + '</span><span class="hl-t">' + esc(c.text) + '</span></div>';
      }
      el.innerHTML = '<div class="title">Sağlık özeti</div><div class="hl-h ' + cls + '"><i></i>' + head + '</div><div class="hls">' + rows + '</div>';
    }
  };

  // ---- Servis kontrolu: ayakta mi + yanit suresi grafigi ----
  function spark(hist) {
    var n = hist.length, i, v, max = 200, d = '', pen = false, miss = '';
    if (n < 2) return '';
    for (i = 0; i < n; i++) if (hist[i] !== null && hist[i] > max) max = hist[i];
    for (i = 0; i < n; i++) {
      var x = (i / (n - 1) * 100).toFixed(1);
      v = hist[i];
      if (v === null) { pen = false; miss += '<line x1="' + x + '" y1="2" x2="' + x + '" y2="22" class="sv-miss"/>'; continue; }
      d += (pen ? 'L' : 'M') + x + ' ' + (22 - Math.min(1, v / max) * 19).toFixed(1) + ' ';
      pen = true;
    }
    return '<svg class="sv-sp" viewBox="0 0 100 24" preserveAspectRatio="none"><path d="' + d + '" class="sv-line"/>' + miss + '</svg>';
  }
  widgets.services = {
    deps: ['services'],
    render: function (el, opts, def) {
      var d = S.services && S.services.data;
      if (!d) { el.innerHTML = '<div class="title">Servisler</div><div class="hint">Servis kontrolü kapalı. Sunucuda <b>SERVICES</b> ayarla: <code>Ad=http://host:port</code></div>'; return; }
      var list = d.services, up = 0, i, rows = '';
      for (i = 0; i < list.length; i++) if (list[i].status !== 'down') up++;
      var cls = up === list.length ? 'ok' : 'bad';
      var max = def && def.h >= 5 ? 8 : 4;
      for (i = 0; i < list.length && i < max; i++) {
        var s = list[i], txt = s.status === 'down' ? esc(s.err || 'kapalı') : s.ms + '<small> ms</small>';
        rows += '<div class="sv ' + s.status + '"><i></i><span class="sv-n">' + esc(s.name) + '</span>' + spark(s.hist) + '<span class="sv-t">' + txt + '</span></div>';
      }
      el.innerHTML = '<div class="title">Servisler · <span class="sv-h ' + cls + '">' + up + '/' + list.length + ' ayakta</span></div><div class="svs">' + rows + '</div>';
    }
  };

  // ---- Calan sarki (Muzik / Spotify, macOS agent) ----
  function fmtT(s) { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + pad(s % 60); }
  widgets.nowplaying = {
    deps: ['media'], tick: true,
    render: function (el, opts, def) {
      var m = S.media && S.media.data, p = m && m.players && m.players[0];
      if (!p) {
        if (el._npKey !== 'none') {
          el._npKey = 'none';
          el.innerHTML = '<div class="title">Çalıyor</div><div class="np-empty"><div class="np-ic">♪</div>Çalan bir şey yok<small>Mac’te Müzik ya da Spotify’dan bir şarkı başlat</small></div>';
        }
        return;
      }
      var key = S.media.ts + '|' + def.w + 'x' + def.h;
      if (el._npKey !== key) {
        el._npKey = key; el._npT0 = Date.now(); el._npPos = p.position || 0;
        var big = def.h >= 5, playing = p.state === 'playing';
        var art = p.artwork ? '<img class="np-art" src="' + esc(p.artwork) + '" alt="">' : '<div class="np-art np-noart">♪</div>';
        el.innerHTML = '<div class="title">' + (p.app === 'spotify' ? 'Spotify' : 'Apple Music') + ' · ' + esc(p.label) + '</div>' +
          '<div class="np' + (big ? ' xl' : '') + '">' + art + '<div class="np-b">' +
          '<div class="np-t">' + esc(p.title) + '</div>' +
          '<div class="np-a">' + esc(p.artist) + '</div>' + (p.album ? '<div class="np-al">' + esc(p.album) + '</div>' : '') +
          (p.duration ? '<div class="np-bar"><div class="np-fill"></div></div><div class="np-tm"></div>' : '') +
          '<div class="np-ctl"><button class="np-btn" data-a="previous" aria-label="Önceki">⏮</button>' +
          '<button class="np-btn np-pp" data-a="playpause" aria-label="' + (playing ? 'Duraklat' : 'Oynat') + '">' + (playing ? '⏸' : '▶') + '</button>' +
          '<button class="np-btn" data-a="next" aria-label="Sonraki">⏭</button></div></div></div>';
        var btns = el.querySelectorAll('.np-btn'), host = p.host;
        for (var i = 0; i < btns.length; i++) btns[i].addEventListener('click', function (e) {
          var b = e.currentTarget; b.classList.add('sent'); setTimeout(function () { b.classList.remove('sent'); }, 400);
          fetch(api('/api/media/command'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ host: host, action: b.getAttribute('data-a') }) }).catch(function () {});
        });
      }
      var bar = el.querySelector('.np-fill'), tm = el.querySelector('.np-tm');
      if (bar && p.duration) {
        var pos = clamp(el._npPos + (p.state === 'playing' ? (Date.now() - el._npT0) / 1000 : 0), 0, p.duration);
        bar.style.width = (pos / p.duration * 100).toFixed(1) + '%';
        tm.textContent = fmtT(pos) + ' / ' + fmtT(p.duration);
      }
    }
  };

  widgets.notify = {
    deps: ['push'], tick: true,
    render: function (el, opts, def) {
      var p = S.push && S.push.data, now = Date.now();
      var n = (p ? p.notes : []).filter(function (x) { return x.until > now; });
      var max = def.h >= 5 ? 10 : 3;
      var rows = '';
      n.slice(0, max).forEach(function (x) {
        rows += '<div class="nt ' + esc(x.level) + '"><span class="nt-d"></span><span class="nt-b">' + (x.title ? '<b>' + esc(x.title) + '</b> ' : '') + esc(x.text) + '</span><span class="nt-t">' + fmtDur((now - x.ts) / 60000) + '</span></div>';
      });
      el.innerHTML = '<div class="title">Bildirimler' + (n.length ? ' · ' + n.length : '') + '</div>' + (rows ? '<div class="nts">' + rows + '</div>' : '<div class="hint">Bildirim yok.</div>');
    }
  };

  // ---- Piyasa ve haber: doviz, kripto, Hacker News ----
  function fmtNum(n, d) { return Number(n).toLocaleString('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function chg(c) {
    if (c === null || c === undefined) return '<span class="dim">—</span>';
    return '<span class="chg ' + (c > 0.005 ? 'up' : c < -0.005 ? 'dn' : '') + '">' + (c > 0.005 ? '▲' : c < -0.005 ? '▼' : '•') + ' ' + fmtNum(Math.abs(c), 2) + '%</span>';
  }
  widgets.fx = {
    deps: ['fx'],
    render: function (el) {
      var d = S.fx && S.fx.data;
      if (!d) { el.innerHTML = '<div class="title">Döviz</div><div class="dim">' + (S.fx && S.fx.error ? esc(S.fx.error) : 'veri yok') + '</div>'; return; }
      var rows = '';
      d.rates.forEach(function (r) { rows += '<div class="mk"><span class="mk-s">' + esc(r.code) + '</span><span class="mk-v">' + fmtNum(r.rate, 2) + ' <small>₺</small></span>' + chg(r.change) + '</div>'; });
      el.innerHTML = '<div class="title">Döviz · TRY</div><div class="mks">' + rows + '</div>';
    }
  };
  widgets.crypto = {
    deps: ['crypto'],
    render: function (el, opts, def) {
      var d = S.crypto && S.crypto.data;
      if (!d) { el.innerHTML = '<div class="title">Kripto</div><div class="dim">' + (S.crypto && S.crypto.error ? esc(S.crypto.error) : 'veri yok') + '</div>'; return; }
      var rows = '', wide = def.w >= 6;
      d.coins.forEach(function (c) {
        rows += '<div class="mk"><span class="mk-s">' + esc(c.sym) + '</span><span class="mk-v">$' + fmtNum(c.usd, c.usd >= 100 ? 0 : 2) + '</span>' +
          (wide && c.try !== null ? '<span class="mk-t dim">' + fmtNum(c.try, 0) + ' ₺</span>' : '') + chg(c.change) + '</div>';
      });
      el.innerHTML = '<div class="title">Kripto · 24 saat</div><div class="mks">' + rows + '</div>';
    }
  };
  widgets.gold = {
    deps: ['gold'],
    render: function (el, opts, def) {
      var g = S.gold && S.gold.data;
      if (!g) { el.innerHTML = '<div class="title">Altın</div><div class="dim">' + (S.gold && S.gold.error ? esc(S.gold.error) : 'veri yok') + '</div>'; return; }
      var n = def.h >= 5 ? 6 : def.h >= 3 ? 3 : 2, wide = def.w >= 6, rows = '', shown = 0;
      var withOns = g.ounceUsd !== null;
      var room = n - (withOns ? 1 : 0);
      g.items.forEach(function (it) {
        if (shown >= room) return;
        shown++;
        rows += '<div class="mk"><span class="mk-s gd">' + esc(it.name) + '</span><span class="mk-v">' + fmtNum(it.sell, it.sell >= 1000 ? 0 : 2) + ' <small>₺</small></span>' +
          (wide && it.buy !== null ? '<span class="mk-t dim">alış ' + fmtNum(it.buy, it.buy >= 1000 ? 0 : 2) + '</span>' : '') + chg(it.change) + '</div>';
      });
      if (withOns) rows += '<div class="mk"><span class="mk-s gd">Ons</span><span class="mk-v">$' + fmtNum(g.ounceUsd, 0) + '</span></div>';
      var note = g.source === 'spot' ? 'spot fiyattan hesaplandı; kuyumcu fiyatı daha yüksektir' : 'satış fiyatı · kaynak Truncgil' + (g.date ? ' · ' + g.date.slice(11) : '');
      el.innerHTML = '<div class="title">Altın · TL</div><div class="mks">' + rows + '</div>' + (def.h >= 3 ? '<div class="mk-n dim">' + note + '</div>' : '');
    }
  };
  widgets.hn = {
    deps: ['hn'], tick: true,
    render: function (el, opts, def) {
      var d = S.hn && S.hn.data;
      if (!d) { el.innerHTML = '<div class="title">Hacker News</div><div class="dim">' + (S.hn && S.hn.error ? esc(S.hn.error) : 'veri yok') + '</div>'; return; }
      var max = def.h >= 5 ? 10 : def.h >= 3 ? 5 : 3, rows = '';
      d.stories.slice(0, max).forEach(function (s, i) {
        rows += '<div class="hn"><span class="hn-n">' + (i + 1) + '</span><span class="hn-b"><span class="hn-t">' + esc(s.title) + '</span><small>▲ ' + s.score + ' · ' + s.comments + ' yorum' + (s.host ? ' · ' + esc(s.host) : '') + '</small></span></div>';
      });
      el.innerHTML = '<div class="title">Hacker News</div><div class="hns">' + rows + '</div>';
    }
  };

  // ---- Siradaki etkinlik (takvimden): su an / siradaki, geri sayim, ilerleme ----
  widgets.nextup = {
    deps: ['calendar'], tick: true,
    render: function (el) {
      var c = S.calendar && S.calendar.data;
      if (!c) { el.innerHTML = '<div class="title">Sıradaki etkinlik</div><div class="hint">Takvim bağlı değil.</div>'; return; }
      var now = Date.now(), cur = null, nxt = null, after = null;
      c.events.forEach(function (e) {
        if (e.allDay) return;
        var end = e.end > e.start ? e.end : e.start + 1;
        if (end <= now) return;
        if (e.start <= now) { if (!cur || e.start > cur.start) cur = e; }
        else if (!nxt || e.start < nxt.start) { after = nxt; nxt = e; }
        else if (!after || e.start < after.start) after = e;
      });
      if (!cur && !nxt) { el.innerHTML = '<div class="title">Sıradaki etkinlik</div><div class="nu-none">Etkinlik yok</div>'; return; }
      var e = cur || nxt, sd = new Date(e.start), ed = new Date(e.end);
      var label = cur ? 'ŞU AN' : 'SIRADAKİ', info, bar = '';
      var hhmm = pad(sd.getHours()) + ':' + pad(sd.getMinutes());
      if (cur) {
        var pct = clamp((now - e.start) / Math.max(1, e.end - e.start) * 100, 0, 100);
        info = pad(ed.getHours()) + ':' + pad(ed.getMinutes()) + ' bitiyor · ' + fmtDur((e.end - now) / 60000) + ' kaldı';
        bar = '<div class="nu-bar"><i style="width:' + pct.toFixed(1) + '%"></i></div>';
      } else {
        var day = ymd(sd) === ymd(new Date()) ? '' : ymd(sd) === ymd(new Date(now + 86400000)) ? 'Yarın ' : DAYS_S[sd.getDay()] + ' ';
        info = day + hhmm + ' · ' + fmtDur((e.start - now) / 60000) + ' sonra';
      }
      var follow = cur ? nxt : after;
      el.innerHTML = '<div class="title">' + label + '</div><div class="nu"><div class="nu-t">' + esc(e.title) + '</div><div class="nu-i">' + info + '</div>' + bar +
        (e.location ? '<div class="nu-l dim">' + esc(e.location) + '</div>' : '') + '</div>' +
        (follow ? '<div class="nu-f dim">Sonra: ' + pad(new Date(follow.start).getHours()) + ':' + pad(new Date(follow.start).getMinutes()) + ' ' + esc(follow.title) + '</div>' : '');
    }
  };

  // ---- Dunya saatleri ----
  var WORLD_SETS = {
    dunya: [['İstanbul', 'Europe/Istanbul'], ['Londra', 'Europe/London'], ['New York', 'America/New_York'], ['Tokyo', 'Asia/Tokyo']],
    avrupa: [['İstanbul', 'Europe/Istanbul'], ['Londra', 'Europe/London'], ['Berlin', 'Europe/Berlin'], ['Paris', 'Europe/Paris'], ['Moskova', 'Europe/Moscow']],
    amerika: [['İstanbul', 'Europe/Istanbul'], ['New York', 'America/New_York'], ['Chicago', 'America/Chicago'], ['Los Angeles', 'America/Los_Angeles'], ['São Paulo', 'America/Sao_Paulo']],
    asya: [['İstanbul', 'Europe/Istanbul'], ['Dubai', 'Asia/Dubai'], ['Delhi', 'Asia/Kolkata'], ['Tokyo', 'Asia/Tokyo'], ['Sidney', 'Australia/Sydney']]
  };
  var tzFmt = {};
  function zoneParts(tz, date) {
    var f = tzFmt[tz] || (tzFmt[tz] = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit' }));
    var o = {}; f.formatToParts(date).forEach(function (p) { o[p.type] = p.value; });
    return { h: +o.hour, m: +o.minute, day: o.year + '-' + o.month + '-' + o.day };
  }
  widgets.worldclock = {
    deps: [], tick: true,
    render: function (el, opts) {
      var set = WORLD_SETS[opts && opts.set] || WORLD_SETS.dunya, now = new Date(), home = zoneParts('Europe/Istanbul', now), rows = '';
      set.forEach(function (c) {
        var z = zoneParts(c[1], now), rel = z.day === home.day ? '' : z.day > home.day ? 'yarın' : 'dün', night = z.h < 6 || z.h >= 20;
        rows += '<div class="wz"><span class="wz-i">' + Icons.ic(night ? 'moon' : 'sun') + '</span><span class="wz-c">' + esc(c[0]) + (rel ? '<small>' + rel + '</small>' : '') + '</span><span class="wz-t">' + pad(z.h) + ':' + pad(z.m) + '</span></div>';
      });
      el.innerHTML = '<div class="title">Dünya saatleri</div><div class="wzs">' + rows + '</div>';
    }
  };

  // ---- Kelime saati: saati Turkce cumle olarak yazar ("on dördü yirmi geçiyor") ----
  var H_NOM = ['on iki', 'bir', 'iki', 'üç', 'dört', 'beş', 'altı', 'yedi', 'sekiz', 'dokuz', 'on', 'on bir'];
  var H_ACC = ['on ikiyi', 'biri', 'ikiyi', 'üçü', 'dördü', 'beşi', 'altıyı', 'yediyi', 'sekizi', 'dokuzu', 'onu', 'on biri'];
  var H_DAT = ['on ikiye', 'bire', 'ikiye', 'üçe', 'dörde', 'beşe', 'altıya', 'yediye', 'sekize', 'dokuza', 'ona', 'on bire'];
  var M_WORD = { 5: 'beş', 10: 'on', 15: 'çeyrek', 20: 'yirmi', 25: 'yirmi beş' };
  // Saf fonksiyon: { lines:[...] } - en yakin 5 dakikaya yuvarlar
  function wordTime(h, m) {
    var m5 = Math.round(m / 5) * 5, hh = h;
    if (m5 === 60) { m5 = 0; hh = h + 1; }
    var i = hh % 12, n = (hh + 1) % 12;
    if (m5 === 0) return ['saat', H_NOM[i]];
    if (m5 === 30) return ['saat', H_NOM[i], 'buçuk'];
    if (m5 < 30) return ['saat', H_ACC[i], M_WORD[m5], 'geçiyor'];
    return ['saat', H_DAT[n], M_WORD[60 - m5], 'var'];
  }
  widgets.wordclock = {
    deps: [], tick: true,
    render: function (el) {
      var d = new Date(), w = wordTime(d.getHours(), d.getMinutes()), key = w.join(' ');
      if (el._wk === key && el.firstChild) return;
      el._wk = key;
      el.innerHTML = '<div class="grow wc-w">' + w.map(function (x, i) { return '<div class="wc-l' + (i === 0 ? ' dim' : '') + '">' + esc(x) + '</div>'; }).join('') + '</div>';
    }
  };

  // ---- Akilli yigin (Smart Stack): secili widget'lar sirayla doner; dokununca bir sonrakine gecer ----
  var STACK_TYPES = ['weather', 'calendar', 'nextup', 'worldclock', 'wordclock', 'clock', 'fx', 'crypto', 'gold', 'hn', 'quota', 'sky', 'airq', 'ha_air', 'ha_vac', 'ha_clim', 'modem', 'network', 'gitea', 'notify', 'pushvals', 'sessions', 'health'];
  widgets.stack = {
    deps: (function () { var o = {}; STACK_TYPES.forEach(function (t) { ((widgets[t] && widgets[t].deps) || []).forEach(function (d) { o[d] = 1; }); }); return Object.keys(o); })(),
    tick: true,
    render: function (el, opts, def) {
      var types = [opts.a, opts.b, opts.c, opts.d].filter(function (t, i, a) { return t && t !== 'none' && widgets[t] && STACK_TYPES.indexOf(t) >= 0 && a.indexOf(t) === i; });
      if (!types.length) { el.innerHTML = '<div class="title">Akıllı yığın</div><div class="hint">' + Icons.ic('sliders') + ' Ayar’dan en az bir widget seç.</div>'; el._sig = ''; return; }
      var sig = types.join(',');
      if (el._sig !== sig) {
        el._sig = sig; el._off = 0; el._slots = {};
        el.innerHTML = '';
        types.forEach(function (t) { var s = document.createElement('div'); s.className = 'stk-s'; s.style.display = 'none'; el.appendChild(s); el._slots[t] = { el: s, stamp: '' }; });
        var dots = document.createElement('div'); dots.className = 'stk-d'; el.appendChild(dots); el._dots = dots;
        el.addEventListener('click', function () { el._off = (el._off || 0) + 1; el._last = null; });
      }
      var every = Math.max(3, +opts.every || 8) * 1000;
      var idx = (Math.floor(Date.now() / every) + (el._off || 0)) % types.length;
      var t = types[idx], slot = el._slots[t], impl = widgets[t];
      if (el._last !== t) {
        types.forEach(function (x) { el._slots[x].el.style.display = x === t ? 'flex' : 'none'; });
        el._dots.innerHTML = types.map(function (x, i) { return '<i' + (i === idx ? ' class="on"' : '') + '></i>'; }).join('');
        el._last = t; slot.stamp = '';
      }
      var stamp = (impl.deps || []).map(function (d) { return S[d] ? S[d].ts : 0; }).join('|') + '|' + def.w + 'x' + def.h;
      if (slot.stamp !== stamp || impl.tick) {
        slot.stamp = stamp;
        var sub = {}; for (var k in def) sub[k] = def[k];
        sub.type = t; sub.opts = CATALOG[t].defaults || {};
        impl.render(slot.el, sub.opts, sub);
      }
    }
  };

  // ---------- duzen yardimcilari ----------
  function assignIds() {
    layout.pages.forEach(function (pg) {
      if (!pg.widgets) pg.widgets = [];
      pg.widgets.forEach(function (d) { if (!d._id) d._id = ++uid; });
    });
  }
  function canPlace(list, c, r, w, h, ignore) {
    if (c < 1 || r < 1 || c + w - 1 > COLS || r + h - 1 > ROWS) return false;
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (o === ignore) continue;
      if (c < o.col + o.w && c + w > o.col && r < o.row + o.h && r + h > o.row) return false;
    }
    return true;
  }
  function findSpot(list, w, h, ignore) {
    for (var r = 1; r <= ROWS + 1 - h; r++) for (var c = 1; c <= COLS + 1 - w; c++) if (canPlace(list, c, r, w, h, ignore)) return { col: c, row: r };
    return null;
  }
  function pageOfDef(def) {
    for (var i = 0; i < layout.pages.length; i++) if (layout.pages[i].widgets.indexOf(def) >= 0) return layout.pages[i];
    return null;
  }
  function serialize() {
    return JSON.stringify({
      idleReturnSec: layout.idleReturnSec,
      pages: layout.pages.map(function (pg) {
        return {
          id: pg.id, title: pg.title,
          widgets: pg.widgets.map(function (d) {
            var o = { type: d.type, col: d.col, row: d.row, w: d.w, h: d.h };
            if (d.opts) o.opts = d.opts;
            if (d.nopad) o.nopad = true;
            return o;
          })
        };
      })
    });
  }

  // ---------- sayfa kurulumu ----------
  var pagesEl = document.getElementById('pages');
  var dotsEl = document.getElementById('dots');
  var barEl = document.getElementById('bar');
  var editbarEl = document.getElementById('editbar');
  var sheetEl = document.getElementById('sheet');
  var toastEl = document.getElementById('toast');

  function makeWidget(def) {
    var impl = widgets[def.type];
    var el = document.createElement('div');
    el.className = 'w h' + def.h + ' w' + def.w + (def.nopad ? ' nopad' : '') + (editing ? ' edit' : '') + (editing && selectedId === def._id ? ' sel' : '');
    el.style.gridColumn = def.col + ' / span ' + def.w;
    el.style.gridRow = def.row + ' / span ' + def.h;
    var body = document.createElement('div');
    body.className = 'wc';
    el.appendChild(body);
    if (editing) {
      var eo = document.createElement('div');
      eo.className = 'eo';
      eo.innerHTML = '<button class="rm" data-act="rm" aria-label="Kaldır">−</button>';
      el.appendChild(eo);
    }
    if (!impl) body.innerHTML = '<div class="title">' + esc(def.type) + '</div><div class="dim">bilinmeyen widget</div>';
    else widgetEls.push({ el: el, body: body, def: def, impl: impl });
    return el;
  }

  function build(keepScroll) {
    var sl = pagesEl.scrollLeft;
    pagesEl.innerHTML = '';
    widgetEls = [];
    layout.pages.forEach(function (pg, pi) {
      var page = document.createElement('section');
      page.className = 'page';
      page.setAttribute('data-index', pi);
      pg.widgets.forEach(function (def) { page.appendChild(makeWidget(def)); });
      if (editing && pg.widgets.length === 0) {
        var hint = document.createElement('div');
        hint.className = 'empty-hint';
        hint.innerHTML = '<div>Boş sayfa</div><small>widget sürükle ya da “＋ Widget” ile ekle</small>' +
          (layout.pages.length > 1 ? '<button data-act="delpage" data-i="' + pi + '">Sayfayı sil</button>' : '');
        page.appendChild(hint);
      }
      pagesEl.appendChild(page);
    });
    if (editing) {
      var np = document.createElement('section');
      np.className = 'page newpage';
      np.setAttribute('data-index', layout.pages.length);
      np.innerHTML = '<button class="np-btn" data-act="newpage">＋ Yeni sayfa<small>widget’ı buraya bırak ya da dokun</small></button>';
      pagesEl.appendChild(np);
    }
    buildDots();
    renderAll();
    if (keepScroll) pagesEl.scrollLeft = sl;
  }

  // Sayfa çubuğu: varsayılan olarak sayfa adları (PAGEBAR=dots ile eski noktalar)
  var pagebar = 'names';
  function buildDots() {
    var n = layout.pages.length + (editing ? 1 : 0);
    var cur = Math.round(pagesEl.scrollLeft / (pagesEl.clientWidth || 1));
    dotsEl.className = 'dots ' + (pagebar === 'dots' ? 'dotmode' : 'names');
    var html = '';
    for (var i = 0; i < n; i++) {
      var name = i < layout.pages.length ? (layout.pages[i].title || String(i + 1)) : '＋';
      html += pagebar === 'dots' ? '<div class="dot' + (i === cur ? ' on' : '') + '"></div>'
        : '<button class="pg' + (i === cur ? ' on' : '') + '" data-i="' + i + '">' + esc(name) + '</button>';
    }
    dotsEl.innerHTML = html;
    centerPageItem(cur, false);
  }
  function centerPageItem(i, smooth) {
    var el = dotsEl.children[i];
    if (!el || pagebar === 'dots') return;
    dotsEl.scrollTo({ left: el.offsetLeft - (dotsEl.clientWidth - el.offsetWidth) / 2, behavior: smooth ? 'smooth' : 'auto' });
  }

  function renderOne(w) {
    var el = w.el;
    w.impl.render(w.body, w.def.opts || {}, w.def);
    var stale = false, sim = false;
    (w.impl.deps || []).forEach(function (d) { if (S[d]) { if (S[d].stale) stale = true; if (S[d].simulated) sim = true; } });
    el.classList.toggle('stale', stale);
    el.classList.toggle('sim', sim);
  }
  function renderAll() { widgetEls.forEach(renderOne); }

  var pending = {}, scheduled = false;
  function schedule(name) {
    pending[name] = true;
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () {
      scheduled = false;
      widgetEls.forEach(function (w) {
        var deps = w.impl.deps || [];
        for (var i = 0; i < deps.length; i++) if (pending[deps[i]]) { renderOne(w); break; }
      });
      pending = {};
    });
  }

  setInterval(function () { widgetEls.forEach(function (w) { if (w.impl.tick) renderOne(w); }); }, 1000);

  // ---------- gezinme: aktif nokta, bosta ana sayfaya don ----------
  var idleTimer = null;
  function resetIdle() {
    clearTimeout(idleTimer);
    if (editing || !layout) return;
    var sec = layout.idleReturnSec || 90;
    idleTimer = setTimeout(function () { pagesEl.scrollTo({ left: 0, behavior: 'smooth' }); }, sec * 1000);
  }
  pagesEl.addEventListener('scroll', function () {
    var i = Math.round(pagesEl.scrollLeft / pagesEl.clientWidth);
    var dots = dotsEl.children, base = pagebar === 'dots' ? 'dot' : 'pg';
    for (var k = 0; k < dots.length; k++) dots[k].className = base + (k === i ? ' on' : '');
    centerPageItem(i, true);
    resetIdle();
  });
  ['touchstart', 'mousedown', 'keydown'].forEach(function (ev) { document.addEventListener(ev, resetIdle, { passive: true }); });
  document.addEventListener('keydown', function (e) {
    if (sheetMode === 'pin') return;
    var w = pagesEl.clientWidth;
    if (e.key === 'ArrowRight') pagesEl.scrollBy({ left: w, behavior: 'smooth' });
    if (e.key === 'ArrowLeft') pagesEl.scrollBy({ left: -w, behavior: 'smooth' });
  });
  dotsEl.addEventListener('click', function (e) {
    var idx = Array.prototype.indexOf.call(dotsEl.children, e.target.closest('.pg, .dot') || e.target);
    if (idx >= 0) pagesEl.scrollTo({ left: idx * pagesEl.clientWidth, behavior: 'smooth' });
  });
  function currentPageIndex() { return Math.round(pagesEl.scrollLeft / (pagesEl.clientWidth || 1)); }
  document.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  // =====================================================================
  // DUZENLEME MODU
  // =====================================================================
  var editing = false, selectedId = null, editPin = '', history = [];
  var dirty = false, savedRev = 0, saveT = null, saveLabel = '', editIdleT = null;
  var sheetMode = '', pinBuf = '', pinPurpose = 'edit', pinTarget = '', pinTitle = 'Düzenleme PIN’i';

  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('on');
    clearTimeout(showToast.t);
    showToast.t = setTimeout(function () { toastEl.classList.remove('on'); }, 2200);
  }

  // ---- sheet (PIN, galeri, ayar, onay) ----
  function openSheet(html, mode) { sheetMode = mode; sheetEl.innerHTML = html; sheetEl.classList.add('on'); }
  function closeSheet() { sheetMode = ''; pinPurpose = 'edit'; pinTitle = 'Düzenleme PIN’i'; sheetEl.classList.remove('on'); sheetEl.innerHTML = ''; }

  function pinHtml(msg) {
    var dots = '';
    for (var i = 0; i < 4; i++) dots += '<i class="' + (i < pinBuf.length ? 'f' : '') + '"></i>';
    var keys = '';
    [1, 2, 3, 4, 5, 6, 7, 8, 9].forEach(function (k) { keys += '<button data-k="' + k + '">' + k + '</button>'; });
    keys += '<button data-k="x" class="alt">İptal</button><button data-k="0">0</button><button data-k="b" class="alt">⌫</button>';
    return '<div class="card pin"><div class="ph">' + esc(pinTitle) + '</div><div class="pd">' + dots + '</div>' +
      '<div class="pm">' + (msg || '&nbsp;') + '</div><div class="pk">' + keys + '</div></div>';
  }
  function askPin(msg) {
    pinBuf = '';
    openSheet(pinHtml(msg), 'pin');
  }
  function submitPin() {
    var pin = pinBuf;
    if (pinPurpose === 'approve') { sendDecision(pinTarget, 'allow', pin); return; }
    fetch(api('/api/edit/verify'), { method: 'POST', headers: { 'x-edit-pin': pin } }).then(function (r) {
      if (r.status === 204) { editPin = pin; closeSheet(); startEdit(); return; }
      askPin(r.status === 429 ? 'Çok fazla deneme, 1 dk bekle' : 'Yanlış PIN');
      sheetEl.querySelector('.card').classList.add('shake');
    }).catch(function () { askPin('Hub’a ulaşılamıyor'); });
  }
  sheetEl.addEventListener('click', function (e) {
    var t = e.target.closest('[data-k]');
    if (t && sheetMode === 'pin') {
      var k = t.getAttribute('data-k');
      if (k === 'x') { closeSheet(); return; }
      if (k === 'b') pinBuf = pinBuf.slice(0, -1);
      else if (pinBuf.length < 4) pinBuf += k;
      sheetEl.innerHTML = pinHtml();
      if (pinBuf.length === 4) submitPin();
      return;
    }
    var add = e.target.closest('[data-add]');
    if (add) { addWidget(add.getAttribute('data-add')); return; }
    var opt = e.target.closest('[data-opt]');
    if (opt) { setOpt(opt.getAttribute('data-opt'), opt.getAttribute('data-val')); return; }
    var c = e.target.closest('[data-confirm]');
    if (c) { var v = c.getAttribute('data-confirm'); closeSheet(); if (v === 'reset') doReset(); return; }
    if (e.target === sheetEl || e.target.closest('[data-close]')) closeSheet();
  });
  document.addEventListener('keydown', function (e) {
    if (sheetMode !== 'pin') return;
    if (/^[0-9]$/.test(e.key) && pinBuf.length < 4) { pinBuf += e.key; sheetEl.innerHTML = pinHtml(); if (pinBuf.length === 4) submitPin(); }
    else if (e.key === 'Backspace') { pinBuf = pinBuf.slice(0, -1); sheetEl.innerHTML = pinHtml(); }
    else if (e.key === 'Escape') closeSheet();
  });

  // ---- gecmis (geri al) ve kaydetme ----
  function pushHistory() { history.push(JSON.stringify(layout)); if (history.length > 20) history.shift(); }
  function undo() {
    if (!history.length) return;
    layout = JSON.parse(history.pop());
    selectedId = null;
    commit();
  }
  function commit() {
    dirty = true;
    build(true);
    renderEditbar();
    scheduleSave();
  }
  function scheduleSave() {
    clearTimeout(saveT);
    saveLabel = 'kaydediliyor…';
    updateSaveLabel();
    saveT = setTimeout(save, 400);
  }
  function updateSaveLabel() { var s = document.getElementById('saveState'); if (s) s.textContent = saveLabel; }
  function save() {
    clearTimeout(saveT);
    if (!dirty) return Promise.resolve(true);
    return fetch(api('/api/layout'), { method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-edit-pin': editPin }, body: serialize() })
      .then(function (r) {
        if (!r.ok) throw new Error('http ' + r.status);
        return r.json();
      }).then(function (j) {
        savedRev = j.rev; dirty = false; saveLabel = 'kaydedildi ✓'; updateSaveLabel(); return true;
      }).catch(function () {
        saveLabel = 'kaydedilemedi!'; updateSaveLabel(); showToast('Kaydedilemedi, bağlantıyı kontrol et'); return false;
      });
  }

  // ---- giris / cikis ----
  function startEdit() {
    editing = true; selectedId = null; history = []; dirty = false; saveLabel = '';
    document.body.classList.add('editing');
    clearTimeout(idleTimer);
    build(true);
    renderEditbar();
    resetEditIdle();
  }
  function exitEdit() {
    // bos sayfalari temizle (en az bir sayfa kalir)
    var kept = layout.pages.filter(function (p) { return p.widgets.length > 0; });
    if (kept.length !== layout.pages.length) { layout.pages = kept.length ? kept : [layout.pages[0]]; dirty = true; }
    save().then(function (ok) {
      if (!ok) { build(true); renderEditbar(); return; }
      editing = false; selectedId = null; editPin = '';
      clearTimeout(editIdleT);
      document.body.classList.remove('editing');
      editbarEl.classList.remove('on');
      closeSheet();
      build(true);
      resetIdle();
    });
  }
  function resetEditIdle() {
    clearTimeout(editIdleT);
    if (!editing) return;
    editIdleT = setTimeout(function () { if (editing && !drag) exitEdit(); }, 60000);
  }

  // ---- edit bar ----
  function selDef() {
    if (!selectedId) return null;
    for (var i = 0; i < layout.pages.length; i++) {
      var ws = layout.pages[i].widgets;
      for (var j = 0; j < ws.length; j++) if (ws[j]._id === selectedId) return ws[j];
    }
    return null;
  }
  function renderEditbar() {
    var d = selDef(), html = '';
    if (!d) {
      selectedId = null;
      html = '<span class="es" id="saveState">' + esc(saveLabel) + '</span>' +
        '<button data-act="add">＋ Widget</button>' +
        '<button data-act="undo"' + (history.length ? '' : ' disabled') + '>↶ Geri al</button>' +
        '<button data-act="reset">Sıfırla</button>' +
        '<button class="pri" data-act="done">Bitti</button>';
    } else {
      var cat = CATALOG[d.type] || { name: d.type, sizes: [] };
      html = '<span class="en">' + esc(cat.name) + '</span>';
      cat.sizes.forEach(function (s) {
        var on = s[1] === d.w && s[2] === d.h;
        html += '<button class="sz' + (on ? ' on' : '') + '" data-act="size" data-w="' + s[1] + '" data-h="' + s[2] + '">' + s[0] + '<small>' + s[1] + '×' + s[2] + '</small></button>';
      });
      if (cat.opts) html += '<button data-act="opts">' + Icons.ic('sliders') + ' Ayar</button>';
      html += '<button class="danger" data-act="rmsel">Kaldır</button><button class="pri" data-act="desel">Tamam</button>';
    }
    editbarEl.innerHTML = html;
    editbarEl.classList.add('on');
  }

  editbarEl.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    resetEditIdle();
    var act = b.getAttribute('data-act'), d = selDef();
    if (act === 'done') exitEdit();
    else if (act === 'undo') undo();
    else if (act === 'add') openGallery();
    else if (act === 'reset') openSheet('<div class="card"><div class="ph">Varsayılan düzene dön?</div><div class="pm">Mevcut düzen yedeklenir.</div>' +
      '<div class="row"><button data-close="1">Vazgeç</button><button class="danger" data-confirm="reset">Evet, sıfırla</button></div></div>', 'confirm');
    else if (act === 'desel') { selectedId = null; build(true); renderEditbar(); }
    else if (act === 'rmsel' && d) removeDef(d);
    else if (act === 'size' && d) setSize(d, +b.getAttribute('data-w'), +b.getAttribute('data-h'));
    else if (act === 'opts' && d) openOpts(d);
  });

  // ---- sayfa ici dugmeler (kaldir, yeni sayfa, sayfayi sil) ----
  pagesEl.addEventListener('click', function (e) {
    if (!editing) return;
    var b = e.target.closest('[data-act]');
    if (!b) return;
    resetEditIdle();
    var act = b.getAttribute('data-act');
    if (act === 'rm') { var d = defOfEl(b.closest('.w')); if (d) removeDef(d); }
    else if (act === 'newpage') {
      pushHistory();
      layout.pages.push({ id: 'p' + Date.now(), title: 'Sayfa ' + (layout.pages.length + 1), widgets: [] });
      commit();
      pagesEl.scrollTo({ left: (layout.pages.length - 1) * pagesEl.clientWidth, behavior: 'smooth' });
    } else if (act === 'delpage') {
      var i = +b.getAttribute('data-i');
      if (layout.pages.length > 1 && layout.pages[i] && layout.pages[i].widgets.length === 0) { pushHistory(); layout.pages.splice(i, 1); commit(); }
    }
  });

  function defOfEl(el) {
    for (var i = 0; i < widgetEls.length; i++) if (widgetEls[i].el === el) return widgetEls[i].def;
    return null;
  }

  // ---- islemler ----
  function removeDef(d) {
    var pg = pageOfDef(d);
    if (!pg) return;
    pushHistory();
    pg.widgets.splice(pg.widgets.indexOf(d), 1);
    selectedId = null;
    commit();
  }

  function setSize(d, w, h) {
    var pg = pageOfDef(d);
    if (!pg || (d.w === w && d.h === h)) return;
    var c = d.col, r = d.row, ok = canPlace(pg.widgets, c, r, w, h, d);
    if (!ok) { c = Math.min(d.col, COLS + 1 - w); r = Math.min(d.row, ROWS + 1 - h); ok = canPlace(pg.widgets, c, r, w, h, d); }
    if (!ok) { var sp = findSpot(pg.widgets, w, h, d); if (sp) { c = sp.col; r = sp.row; ok = true; } }
    if (!ok) { showToast('Bu boyut için sayfada yer yok'); return; }
    pushHistory();
    d.col = c; d.row = r; d.w = w; d.h = h;
    commit();
  }

  function toggleSelect(d) {
    selectedId = selectedId === d._id ? null : d._id;
    build(true);
    renderEditbar();
  }

  function openGallery() {
    var html = '<div class="card gal"><div class="ph">Widget ekle<button class="x" data-close="1">✕</button></div><div class="gl">';
    CAT_ORDER.forEach(function (cat) {
      var items = '';
      Object.keys(CATALOG).forEach(function (t) {
        if (CATALOG[t].cat === cat) items += '<button class="gi" data-add="' + t + '"><span>' + Icons.ic(CATALOG[t].icon) + '</span>' + esc(CATALOG[t].name) + '</button>';
      });
      if (items) html += '<div class="gc">' + cat + '</div><div class="gg">' + items + '</div>';
    });
    openSheet(html + '</div></div>', 'gallery');
  }

  function addWidget(type) {
    var cat = CATALOG[type];
    if (!cat) return;
    var idx = currentPageIndex();
    var target = layout.pages[idx];
    var order = [cat.def], i;
    for (i = 0; i < cat.sizes.length; i++) if (i !== cat.def) order.push(i);
    var placed = null;
    function tryPage(pg) {
      for (var k = 0; k < order.length; k++) {
        var s = cat.sizes[order[k]], sp = findSpot(pg.widgets, s[1], s[2]);
        if (sp) return { pg: pg, col: sp.col, row: sp.row, w: s[1], h: s[2] };
      }
      return null;
    }
    if (target) placed = tryPage(target);
    if (!placed) { showToast('Bu sayfada yer yok'); return; }
    pushHistory();
    var def = { type: type, col: placed.col, row: placed.row, w: placed.w, h: placed.h, _id: ++uid };
    if (cat.defaults) def.opts = JSON.parse(JSON.stringify(cat.defaults));
    placed.pg.widgets.push(def);
    selectedId = def._id;
    closeSheet();
    commit();
  }

  function openOpts(d) {
    var cat = CATALOG[d.type], html = '<div class="card"><div class="ph">' + esc(cat.name) + '<button class="x" data-close="1">✕</button></div>';
    cat.opts.forEach(function (o) {
      html += '<div class="oc">' + esc(o.label) + '</div><div class="og">';
      var cur = (d.opts && d.opts[o.key]) || (cat.defaults && cat.defaults[o.key]);
      o.choices.forEach(function (c) { html += '<button class="gi' + (cur === c[0] ? ' on' : '') + '" data-opt="' + o.key + '" data-val="' + c[0] + '">' + esc(c[1]) + '</button>'; });
      html += '</div>';
    });
    openSheet(html + '</div>', 'opts');
  }
  function setOpt(key, val) {
    var d = selDef();
    if (!d) return;
    pushHistory();
    d.opts = d.opts || {};
    d.opts[key] = val;
    closeSheet();
    commit();
  }

  function doReset() {
    fetch(api('/api/layout'), { method: 'DELETE', headers: { 'x-edit-pin': editPin } }).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return loadLayout();
    }).then(function () {
      history = []; selectedId = null; dirty = false; saveLabel = 'sıfırlandı';
      build(true); renderEditbar();
    }).catch(function () { showToast('Sıfırlanamadı'); });
  }

  // ---- uzun basma ve surukle-birak ----
  var press = null, drag = null;

  pagesEl.addEventListener('pointerdown', function (e) {
    if (sheetMode) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (editing) {
      resetEditIdle();
      var wEl = e.target.closest('.w');
      if (!wEl || e.target.closest('[data-act]')) return;
      var d = defOfEl(wEl);
      if (!d) return;
      press = { x: e.clientX, y: e.clientY, def: d, el: wEl, drag: false };
      return;
    }
    press = { x: e.clientX, y: e.clientY, lp: setTimeout(function () { press = null; askPin(); }, 500) };
  });

  document.addEventListener('pointermove', function (e) {
    if (!press) return;
    var dx = e.clientX - press.x, dy = e.clientY - press.y, dist = Math.sqrt(dx * dx + dy * dy);
    if (!editing) { if (dist > 10) { clearTimeout(press.lp); press = null; } return; }
    resetEditIdle();
    if (!press.drag) { if (dist < 8) return; press.drag = true; startDrag(e); }
    moveDrag(e);
  });

  function endPress(cancel) {
    if (!press) return;
    if (press.lp) clearTimeout(press.lp);
    if (editing && press.def) {
      if (press.drag) endDrag(cancel);
      else if (!cancel) toggleSelect(press.def);
    }
    press = null;
  }
  document.addEventListener('pointerup', function () { endPress(false); });
  document.addEventListener('pointercancel', function () { endPress(true); });

  function startDrag(e) {
    var r = press.el.getBoundingClientRect();
    var clone = press.el.cloneNode(true);
    clone.className = 'w edit dragclone';
    clone.style.cssText = 'width:' + r.width + 'px;height:' + r.height + 'px;';
    document.body.appendChild(clone);
    press.el.classList.add('dragging');
    editbarEl.classList.remove('on');
    drag = { def: press.def, grabX: e.clientX - r.left, grabY: e.clientY - r.top, w: press.def.w, h: press.def.h,
      clone: clone, ghost: null, tgt: null, edgeT: null, edgeDir: 0 };
  }

  function pageAt(x) {
    var kids = pagesEl.children, best = null;
    for (var i = 0; i < kids.length; i++) {
      var r = kids[i].getBoundingClientRect();
      if (x >= r.left && x < r.right) return kids[i];
      if (!best) best = kids[i];
    }
    return best;
  }

  function moveDrag(e) {
    if (!drag) return;
    drag.clone.style.transform = 'translate(' + (e.clientX - drag.grabX) + 'px,' + (e.clientY - drag.grabY) + 'px) scale(1.04)';
    var pg = pageAt(e.clientX);
    if (!pg) return;
    var r = pg.getBoundingClientRect(), cs = getComputedStyle(pg);
    var pl = parseFloat(cs.paddingLeft), pt = parseFloat(cs.paddingTop), pr = parseFloat(cs.paddingRight), pb = parseFloat(cs.paddingBottom);
    var gx = parseFloat(cs.columnGap || cs.gridColumnGap) || 0, gy = parseFloat(cs.rowGap || cs.gridRowGap) || 0;
    var cw = (r.width - pl - pr - gx * (COLS - 1)) / COLS, ch = (r.height - pt - pb - gy * (ROWS - 1)) / ROWS;
    var col = clamp(Math.round((e.clientX - drag.grabX - r.left - pl) / (cw + gx)) + 1, 1, COLS + 1 - drag.w);
    var row = clamp(Math.round((e.clientY - drag.grabY - r.top - pt) / (ch + gy)) + 1, 1, ROWS + 1 - drag.h);
    var pi = +pg.getAttribute('data-index'), data = layout.pages[pi];
    var ok = canPlace(data ? data.widgets : [], col, row, drag.w, drag.h, drag.def);
    if (!drag.ghost) { drag.ghost = document.createElement('div'); }
    if (drag.ghost.parentNode !== pg) pg.appendChild(drag.ghost);
    drag.ghost.className = 'ghost ' + (ok ? 'ok' : 'bad');
    drag.ghost.style.gridColumn = col + ' / span ' + drag.w;
    drag.ghost.style.gridRow = row + ' / span ' + drag.h;
    drag.tgt = { pi: pi, col: col, row: row, ok: ok };

    // sayfa kenarinda bekleyince sonraki sayfaya gec
    var W = window.innerWidth, dir = e.clientX < W * 0.06 ? -1 : e.clientX > W * 0.94 ? 1 : 0;
    if (dir !== drag.edgeDir) {
      clearTimeout(drag.edgeT);
      drag.edgeDir = dir;
      if (dir) {
        drag.edgeT = setTimeout(function () {
          pagesEl.scrollBy({ left: dir * pagesEl.clientWidth, behavior: 'smooth' });
          if (drag) drag.edgeDir = 0;
        }, 600);
      }
    }
  }

  function endDrag(cancel) {
    var d = drag;
    drag = null;
    clearTimeout(d.edgeT);
    if (d.clone.parentNode) d.clone.parentNode.removeChild(d.clone);
    if (d.ghost && d.ghost.parentNode) d.ghost.parentNode.removeChild(d.ghost);
    var t = d.tgt;
    if (!cancel && t && t.ok) {
      var src = pageOfDef(d.def);
      pushHistory();
      if (src) src.widgets.splice(src.widgets.indexOf(d.def), 1);
      d.def.col = t.col; d.def.row = t.row;
      if (t.pi >= layout.pages.length) layout.pages.push({ id: 'p' + Date.now(), title: 'Sayfa ' + (layout.pages.length + 1), widgets: [d.def] });
      else layout.pages[t.pi].widgets.push(d.def);
      selectedId = d.def._id;
      commit();
      resetEditIdle();
      return;
    }
    if (!cancel && t && !t.ok) showToast('Buraya sığmıyor');
    build(true);
    renderEditbar();
  }

  // ---------- baglanti ----------
  var statusDot = document.getElementById('statusDot');
  var statusText = document.getElementById('statusText');
  function setStatus(ok, txt) { statusDot.className = 'sdot' + (ok ? '' : ' off'); statusText.textContent = txt; }

  // Ev agi disinda (hub'a ulasilamiyorsa) veri gosterme: 20 sn kopuk kalinca tam ekran uyari ile eldeki veriyi gizle.
  var offlineEl = document.getElementById('offline');
  var offlineSince = 0;
  var OFFLINE_AFTER_MS = 20000;
  function markOnline() {
    offlineSince = 0;
    offlineEl.classList.remove('on');
  }
  function markOffline() {
    if (!offlineSince) offlineSince = Date.now();
  }
  setInterval(function () {
    if (offlineSince && Date.now() - offlineSince > OFFLINE_AFTER_MS) {
      if (editing) { closeSheet(); }
      offlineEl.classList.add('on');
    }
  }, 2000);

  function loadLayout() {
    return fetch(api('/api/layout')).then(function (r) { return r.json(); }).then(function (l) { layout = l; assignIds(); });
  }

  function connect() {
    var es = new EventSource(api('/api/events'));
    es.addEventListener('snapshot', function (e) { S = JSON.parse(e.data); apprRecv = Date.now(); renderAll(); renderApprovals(); setStatus(true, 'canlı'); markOnline(); });
    es.addEventListener('update', function (e) { var m = JSON.parse(e.data); S[m.name] = m.entry; schedule(m.name); if (m.name === 'approvals') { apprRecv = Date.now(); renderApprovals(); } setStatus(true, 'canlı'); markOnline(); });
    es.addEventListener('layout', function (e) {
      var m = JSON.parse(e.data);
      if (editing || m.rev === savedRev) return; // kendi kaydimiz ya da duzenleme suruyor
      loadLayout().then(function () { build(true); });
    });
    es.onerror = function () { setStatus(false, 'bağlantı yok'); markOffline(); };
  }

  // ---------- gece kısma ----------
  // Sunucudaki DIM="23:00-07:00" aralığında ekran kararır; dokununca 45 sn uyanır.
  var dimCfg = { from: '23:00', to: '07:00', level: 0.35 }, dimEl = document.getElementById('dim'), dimWake = 0;
  function toMin(t) { var p = String(t).split(':'); return (+p[0]) * 60 + (+p[1]); }
  function dimInRange(c, d) {
    var now = d.getHours() * 60 + d.getMinutes(), a = toMin(c.from), b = toMin(c.to);
    return a === b ? false : a < b ? (now >= a && now < b) : (now >= a || now < b);
  }
  function dimApply() {
    if (!dimEl) return;
    var on = dimCfg && !/[?&]nodim\b/.test(location.search) && Date.now() > dimWake && dimInRange(dimCfg, new Date());
    dimEl.style.opacity = on ? String(+(1 - dimCfg.level).toFixed(2)) : '0';
  }
  document.addEventListener('pointerdown', function () {
    if (dimCfg && dimEl && dimEl.style.opacity !== '0') { dimWake = Date.now() + 45000; dimApply(); setTimeout(dimApply, 45500); }
  }, true);
  fetch(api('/api/ui')).then(function (r) { return r.ok ? r.json() : {}; }).then(function (u) {
    if (u && 'dim' in u) dimCfg = u.dim;
    if (u && (u.pagebar === 'dots' || u.pagebar === 'names') && u.pagebar !== pagebar) { pagebar = u.pagebar; if (layout) buildDots(); }
    dimApply();
  }).catch(function () { dimApply(); });
  setInterval(dimApply, 30000);

  // ---------- Claude izin onayları ----------
  // Hub'a gelen PermissionRequest istekleri ekranın üstünde belirir. "Reddet" tek dokunuş, "İzin ver" PIN ister
  // (PIN 2 dk bellekte tutulur; sayfa yenilenince silinir). İstek 90 sn sonra kendiliğinden düşer, Claude Code
  // o durumda normal onay penceresine döner.
  var apprEl = document.getElementById('appr'), apprSig = '', apprGone = {}, apprPin = '', apprPinUntil = 0, apprRecv = 0, APPR_TTL = 90000;
  function apprList() {
    var a = S.approvals && S.approvals.data;
    return a && a.enabled && a.pending ? a.pending.filter(function (x) { return !apprGone[x.id]; }) : [];
  }
  function apprLeft(a) { return a.expires - S.approvals.ts - (Date.now() - apprRecv); }
  function renderApprovals() {
    if (!apprEl) return;
    var list = apprList();
    var sig = list.map(function (x) { return x.id; }).join(',');
    if (sig === apprSig) return;
    var fresh = list.some(function (x) { return apprSig.indexOf(x.id) < 0; });
    apprSig = sig;
    if (!list.length) { apprEl.classList.remove('on'); apprEl.innerHTML = ''; return; }
    var a = list[0];
    apprEl.innerHTML = '<div class="ap-c"><div class="ap-h"><b>' + Icons.ic('warn') + ' Claude izin istiyor</b><span>' + esc(a.project || '?') + (a.host ? ' · ' + esc(a.host) : '') + '</span><em class="ap-t"></em></div>' +
      '<div class="ap-b"><span class="ap-tool">' + esc(a.tool) + '</span>' + (a.summary ? '<code>' + esc(a.summary) + '</code>' : '') + '</div>' +
      '<div class="ap-bar"><i></i></div>' +
      '<div class="ap-a"><button class="ap-no" data-ap="deny" data-id="' + a.id + '">Reddet</button><button class="ap-yes" data-ap="allow" data-id="' + a.id + '">İzin ver · PIN</button></div>' +
      (list.length > 1 ? '<div class="ap-m">+' + (list.length - 1) + ' bekleyen daha</div>' : '') + '</div>';
    apprEl.classList.add('on');
    if (fresh) { dimWake = Date.now() + 60000; dimApply(); setTimeout(dimApply, 60500); } // gece ekranı uyandır
    tickApprovals();
  }
  function tickApprovals() {
    if (!apprEl || !apprSig) return;
    var list = apprList();
    if (!list.length) { renderApprovals(); return; }
    var left = apprLeft(list[0]);
    if (left <= 0) { apprGone[list[0].id] = true; apprSig = ''; renderApprovals(); return; }
    var t = apprEl.querySelector('.ap-t'), bar = apprEl.querySelector('.ap-bar i');
    if (t) t.textContent = Math.ceil(left / 1000) + ' sn';
    if (bar) bar.style.width = Math.max(0, Math.min(100, left / APPR_TTL * 100)) + '%';
  }
  setInterval(tickApprovals, 1000);
  function askApprovePin(id, msg) {
    pinPurpose = 'approve'; pinTarget = id; pinTitle = 'İzin için PIN';
    askPin(msg || '');
    if (msg) sheetEl.querySelector('.card').classList.add('shake');
  }
  function sendDecision(id, decision, pin) {
    var h = { 'Content-Type': 'application/json' };
    if (pin) h['x-edit-pin'] = pin;
    fetch(api('/api/approval/' + id + '/decide'), { method: 'POST', headers: h, body: JSON.stringify({ decision: decision }) }).then(function (r) {
      if (r.status === 204) {
        apprGone[id] = true;
        if (decision === 'allow') { apprPin = pin; apprPinUntil = Date.now() + 120000; }
        closeSheet(); showToast(decision === 'allow' ? 'İzin verildi' : 'Reddedildi');
        apprSig = ''; renderApprovals(); return;
      }
      if (decision === 'allow' && (r.status === 403 || r.status === 429)) {
        apprPin = ''; askApprovePin(id, r.status === 429 ? 'Çok fazla deneme, 1 dk bekle' : 'Yanlış PIN'); return;
      }
      apprGone[id] = true; closeSheet(); showToast('İstek artık geçerli değil'); apprSig = ''; renderApprovals();
    }).catch(function () {
      if (sheetMode === 'pin') askApprovePin(id, 'Hub’a ulaşılamıyor'); else showToast('Hub’a ulaşılamıyor');
    });
  }
  if (apprEl) apprEl.addEventListener('click', function (e) {
    var b = e.target.closest('[data-ap]');
    if (!b) return;
    var id = b.getAttribute('data-id');
    if (b.getAttribute('data-ap') === 'deny') sendDecision(id, 'deny', '');
    else if (apprPin && Date.now() < apprPinUntil) sendDecision(id, 'allow', apprPin);
    else askApprovePin(id, '');
  });

  loadLayout().then(function () {
    build(); resetIdle(); connect();
  }).catch(function () {
    setStatus(false, 'hub’a ulaşılamıyor');
    offlineSince = Date.now() - OFFLINE_AFTER_MS - 1; // hic yuklenemediyse uyariyi hemen goster
    offlineEl.classList.add('on');
    setTimeout(function () { location.reload(); }, 5000);
  });
})();
