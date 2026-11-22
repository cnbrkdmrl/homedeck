// Piyasa ve haber (anahtarsiz, herkese acik API'ler; hub'dan disari kisisel hicbir sey gitmez):
//  - fx:     Frankfurter (ECB) -> secili doviz kurlari TRY karsiligi. FX_CODES="USD,EUR,GBP"
//  - crypto: CoinGecko -> USD ve TRY fiyat + 24 saatlik degisim. CRYPTO_IDS="bitcoin,ethereum,solana"
//  - hn:     Hacker News (Firebase) -> en cok oy alan haberler. HN_COUNT=8
// Kapatmak icin: MARKET=off
const clip = (s, n) => String(s === null || s === undefined ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);
const ok = (v) => typeof v === 'number' && Number.isFinite(v);

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(10000), redirect: 'follow', headers: { 'User-Agent': 'homedeck' } });
  if (!res.ok) throw new Error('http ' + res.status + ' (' + new URL(url).host + ')');
  return res.json();
}

// ---- Doviz ----
const FX_CODES = (process.env.FX_CODES || 'USD,EUR,GBP').split(',').map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z]{3}$/.test(s) && s !== 'TRY').slice(0, 6);

// Frankfurter zaman serisi -> { code, rate, change } (saf fonksiyon, test edilir). change: son iki is gunu arasindaki yuzde.
export function fxFromSeries(code, json) {
  const r = json && json.rates && typeof json.rates === 'object' ? json.rates : {};
  const days = Object.keys(r).sort();
  const vals = days.map((d) => r[d] && r[d].TRY).filter(ok);
  if (!vals.length) return null;
  const rate = vals[vals.length - 1], prev = vals.length > 1 ? vals[vals.length - 2] : null;
  return { code, rate, change: prev ? ((rate - prev) / prev) * 100 : null, date: days[days.length - 1] };
}

export const fx = {
  name: 'fx',
  interval: 30 * 60 * 1000,
  async run() {
    const from = new Date(Date.now() - 8 * 86400000).toISOString().slice(0, 10);
    const out = [];
    for (const code of FX_CODES) {
      const r = fxFromSeries(code, await getJson('https://api.frankfurter.dev/v1/' + from + '..?base=' + code + '&symbols=TRY'));
      if (r) out.push(r);
    }
    if (!out.length) throw new Error('kur verisi alınamadı');
    return { data: { rates: out }, simulated: false };
  },
};

// ---- Kripto ----
const CRYPTO_IDS = (process.env.CRYPTO_IDS || 'bitcoin,ethereum,solana').split(',').map((s) => s.trim().toLowerCase()).filter((s) => /^[a-z0-9-]+$/.test(s)).slice(0, 8);
const SYMBOLS = { bitcoin: 'BTC', ethereum: 'ETH', solana: 'SOL', ripple: 'XRP', dogecoin: 'DOGE', cardano: 'ADA', litecoin: 'LTC', binancecoin: 'BNB', tether: 'USDT' };

export function normalizeCrypto(json, ids) {
  const out = [];
  for (const id of ids) {
    const c = json && json[id];
    if (!c || !ok(c.usd)) continue;
    out.push({ id, sym: SYMBOLS[id] || id.slice(0, 5).toUpperCase(), usd: c.usd, try: ok(c.try) ? c.try : null, change: ok(c.usd_24h_change) ? c.usd_24h_change : null });
  }
  return out;
}

export const crypto = {
  name: 'crypto',
  interval: 3 * 60 * 1000, // CoinGecko ucretsiz limiti: seyrek sorgula
  async run() {
    const json = await getJson('https://api.coingecko.com/api/v3/simple/price?ids=' + CRYPTO_IDS.join(',') + '&vs_currencies=usd,try&include_24hr_change=true');
    const coins = normalizeCrypto(json, CRYPTO_IDS);
    if (!coins.length) throw new Error('kripto verisi alınamadı');
    return { data: { coins }, simulated: false };
  },
};

// ---- Hacker News ----
const HN_COUNT = Math.max(3, Math.min(15, Number(process.env.HN_COUNT) || 8));

export function normalizeStory(it) {
  if (!it || it.type !== 'story' || it.dead || it.deleted || !it.title) return null;
  let host = '';
  try { host = new URL(it.url).hostname.replace(/^www\./, ''); } catch (e) { /* url'siz (Ask HN vb.) */ }
  return { id: it.id, title: clip(it.title, 120), score: ok(it.score) ? it.score : 0, comments: ok(it.descendants) ? it.descendants : 0, host: clip(host, 40), by: clip(it.by, 20), ts: ok(it.time) ? it.time * 1000 : 0 };
}

export const hn = {
  name: 'hn',
  interval: 10 * 60 * 1000,
  async run() {
    const ids = await getJson('https://hacker-news.firebaseio.com/v0/topstories.json');
    if (!Array.isArray(ids)) throw new Error('hacker news listesi bozuk');
    const items = await Promise.all(ids.slice(0, HN_COUNT).map((id) => getJson('https://hacker-news.firebaseio.com/v0/item/' + Number(id) + '.json').catch(() => null)));
    const stories = items.map(normalizeStory).filter(Boolean);
    if (!stories.length) throw new Error('hacker news haberi alınamadı');
    return { data: { stories }, simulated: false };
  },
};

// ---- Altin ----
// Ana kaynak: Truncgil Finans (Turk piyasasi, alis/satis TL; anahtarsiz). Ons ($) Truncgil'de bos geldigi icin PAX Gold (PAXG,
// 1 token = 1 troy ons fiziki altin) fiyati CoinGecko'dan alinir; o alinamazsa ons gosterilmez. Truncgil yoksa PAXG'den hesaplanan gram/ceyrek gosterilir.
const OZ = 31.1035, CEYREK_G = 1.6043;
const GOLD_ITEMS = [['gram', 'Gram', 'GRA'], ['ceyrek', 'Çeyrek', 'CEYREKALTIN'], ['yarim', 'Yarım', 'YARIMALTIN'], ['tam', 'Tam', 'TAMALTIN'], ['cumhuriyet', 'Cumhuriyet', 'CUMHURIYETALTINI'], ['gumus', 'Gümüş gr', 'GUMUS']];

// Truncgil /v4/today.json + PAXG cevabi -> ekran verisi (saf fonksiyon, test edilir)
export function normalizeGold(tr, paxg) {
  const items = [];
  for (const [key, name, code] of GOLD_ITEMS) {
    const e = tr && tr[code];
    if (!e || !ok(e.Selling) || e.Selling <= 0) continue;
    items.push({ key, name, sell: e.Selling, buy: ok(e.Buying) && e.Buying > 0 ? e.Buying : null, change: ok(e.Change) ? e.Change : null });
  }
  const p = paxg && paxg['pax-gold'];
  const ounceUsd = p && ok(p.usd) ? p.usd : null;
  if (!items.length && p && ok(p.usd) && ok(p.try)) {
    // yedek: spot'tan hesapla (kuyumcu makasi yok)
    const g = p.try / OZ, ch = ok(p.usd_24h_change) ? p.usd_24h_change : null;
    items.push({ key: 'gram', name: 'Gram', sell: g, buy: null, change: ch }, { key: 'ceyrek', name: 'Çeyrek', sell: g * CEYREK_G, buy: null, change: ch });
  }
  if (!items.length) return null;
  return { items, ounceUsd, source: items[0].buy === null && !(tr && tr.GRA) ? 'spot' : 'truncgil', date: tr && typeof tr.Update_Date === 'string' ? tr.Update_Date.slice(0, 16) : null };
}

export const gold = {
  name: 'gold',
  interval: 3 * 60 * 1000,
  async run() {
    const [tr, paxg] = await Promise.all([
      getJson('https://finans.truncgil.com/v4/today.json').catch(() => null),
      getJson('https://api.coingecko.com/api/v3/simple/price?ids=pax-gold&vs_currencies=usd,try&include_24hr_change=true').catch(() => null),
    ]);
    const g = normalizeGold(tr, paxg);
    if (!g) throw new Error('altın verisi alınamadı');
    return { data: g, simulated: false };
  },
};
