// Saglik ozeti hesaplari (tarayicida klasik script, Node testlerinde vm ile yuklenir). Saf fonksiyonlar, DOM yok.
// Girdi: { system, docker, dockerSim, machines } (hub'in veri nesneleri); cikti: { level, checks[] }
// level: 0 yolunda, 1 uyari, 2 sorun
var HealthMath = (function () {
  'use strict';
  var T = { load: [0.9, 1.5], disk: [85, 92], ram: [90, 96], temp: [75, 85] }; // [uyari, sorun]

  function lv(v, t) { return v >= t[1] ? 2 : v >= t[0] ? 1 : 0; }
  function num(v, d) { return String(+v.toFixed(d)).replace('.', ','); }
  function pct(u, t) { return t > 0 ? (u / t) * 100 : 0; }

  // Cevrimici makineler: machines.hosts; yoksa hub'in kendi sistem verisi
  function hosts(inp) {
    var out = [], m = inp.machines && inp.machines.hosts, id;
    if (m) {
      for (id in m) {
        var h = m[id];
        if (h && h.online && h.mem) out.push({ label: h.label || id, mem: h.mem, disks: h.disks || [], temp: h.temp, cores: null });
      }
    }
    if (!out.length && inp.system) {
      var s = inp.system;
      out.push({ label: 'Sunucu', mem: s.mem, disks: s.disk ? [{ name: '/', total: s.disk.total, used: s.disk.used }] : [], temp: s.temp, cores: s.cores });
    }
    return out;
  }

  function evaluate(inp) {
    var checks = [], i, j, s = inp.system;

    // Sistem yuku (hub makinesi): cekirdek basina oran
    if (s && s.load && s.cores) {
      var r = s.load[0] / s.cores;
      checks.push({ key: 'load', label: 'Sistem yükü', level: lv(r, T.load), text: num(s.load[0], 2) + ' · ' + s.cores + ' çekirdek' });
    }

    var hs = hosts(inp);

    // Disk: en dolu
    var worstD = null;
    for (i = 0; i < hs.length; i++) for (j = 0; j < hs[i].disks.length; j++) {
      var d = hs[i].disks[j], p = pct(d.used, d.total);
      if (!worstD || p > worstD.p) worstD = { p: p, name: d.name, host: hs[i].label };
    }
    if (worstD) checks.push({ key: 'disk', label: 'Disk', level: lv(worstD.p, T.disk), text: 'en dolu %' + Math.round(worstD.p) + ' · ' + worstD.host + ' ' + worstD.name });

    // RAM: en yuksek
    var worstR = null;
    for (i = 0; i < hs.length; i++) {
      var rp = pct(hs[i].mem.used, hs[i].mem.total);
      if (!worstR || rp > worstR.p) worstR = { p: rp, host: hs[i].label };
    }
    if (worstR) checks.push({ key: 'ram', label: 'Bellek', level: lv(worstR.p, T.ram), text: '%' + Math.round(worstR.p) + ' · ' + worstR.host });

    // Sicaklik: en yuksek
    var worstT = null;
    for (i = 0; i < hs.length; i++) if (typeof hs[i].temp === 'number' && (!worstT || hs[i].temp > worstT.v)) worstT = { v: hs[i].temp, host: hs[i].label };
    if (worstT) checks.push({ key: 'temp', label: 'Sıcaklık', level: lv(worstT.v, T.temp), text: Math.round(worstT.v) + '° · ' + worstT.host });

    // Konteynerler: calismayanlar. Hata koduyla cikanlar/yeniden baslayanlar sorun, temiz cikanlar uyari
    var c = inp.docker && inp.docker.containers;
    if (c) {
      var run = 0, bad = [], off = [];
      for (i = 0; i < c.length; i++) {
        if (c[i].state === 'running') { run++; continue; }
        var crashed = c[i].state === 'restarting' || c[i].state === 'dead' || /Exited \((?!0\))\d+\)/.test(c[i].status || '');
        (crashed ? bad : off).push(c[i].name);
      }
      var down = bad.concat(off);
      checks.push({ key: 'docker', label: 'Konteynerler', level: bad.length ? 2 : off.length ? 1 : 0,
        text: run + '/' + c.length + ' çalışıyor' + (down.length ? ' · ' + down.slice(0, 2).join(', ') + (down.length > 2 ? ' +' + (down.length - 2) : '') : '') });
    }

    // Makineler: daha once gorulup cevrimdisi kalanlar (hic baglanmamislar sayilmaz)
    var m = inp.machines && inp.machines.hosts;
    if (m) {
      var tot = 0, on = 0, lost = [], id;
      for (id in m) {
        if (!m[id].online && !m[id].seen) continue;
        tot++;
        if (m[id].online) on++; else lost.push(m[id].label || id);
      }
      if (tot) checks.push({ key: 'machines', label: 'Makineler', level: lost.length ? 2 : 0, text: on + '/' + tot + ' çevrimiçi' + (lost.length ? ' · ' + lost.slice(0, 2).join(', ') + ' yok' : '') });
    }

    // Servisler: ayakta mi, yavas mi (SERVICES ayarliysa)
    var sv = inp.services && inp.services.services;
    if (sv && sv.length) {
      var dn = [], sl = [], up = 0;
      for (i = 0; i < sv.length; i++) {
        if (sv[i].status === 'down') dn.push(sv[i].name); else { up++; if (sv[i].status === 'slow') sl.push(sv[i].name); }
      }
      var names = dn.length ? dn : sl;
      checks.push({ key: 'services', label: 'Servisler', level: dn.length ? 2 : sl.length ? 1 : 0,
        text: up + '/' + sv.length + ' ayakta' + (names.length ? ' · ' + names.slice(0, 2).join(', ') + (dn.length ? ' yok' : ' yavaş') : '') });
    }

    var level = 0;
    for (i = 0; i < checks.length; i++) if (checks[i].level > level) level = checks[i].level;
    return { level: level, checks: checks };
  }

  return { evaluate: evaluate };
})();
