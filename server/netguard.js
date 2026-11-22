// Ag koruma: sadece izin verilen adres araliklarindan (varsayilan: ozel ag araliklari + localhost) gelen baglantilari kabul eder.
// Karar dogrudan TCP baglantisinin kaynak adresine dayanir; X-Forwarded-For gibi sahtelenebilir basliklara GUVENILMEZ.
import net from 'node:net';

const DEFAULT_CIDRS = '10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,127.0.0.0/8,::1/128';

function ipv4ToInt(ip) {
  const p = ip.split('.').map(Number);
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}

function ipv6ToBigInt(ip) {
  // "::" kisaltmasini ac ve 8 gruba tamamla
  let [head, tail] = ip.split('::');
  const h = head ? head.split(':') : [];
  const t = tail !== undefined && tail !== '' ? tail.split(':') : [];
  const missing = 8 - h.length - t.length;
  const groups = tail === undefined ? h : [...h, ...Array(missing).fill('0'), ...t];
  return groups.reduce((acc, g) => (acc << 16n) + BigInt(parseInt(g || '0', 16)), 0n);
}

function normalize(addr) {
  if (!addr) return null;
  let a = addr.replace(/^\[|\]$/g, '').split('%')[0]; // zone id'yi at
  const m = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i); // IPv4-mapped IPv6
  if (m) a = m[1];
  return a;
}

function parseCidr(s) {
  const [ip, bitsStr] = s.trim().split('/');
  const fam = net.isIP(ip);
  if (!fam) throw new Error('gecersiz CIDR: ' + s);
  if (fam === 4) {
    const bits = bitsStr === undefined ? 32 : Number(bitsStr);
    if (!(bits >= 0 && bits <= 32)) throw new Error('gecersiz CIDR: ' + s);
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return { fam: 4, net: (ipv4ToInt(ip) & mask) >>> 0, mask: mask };
  }
  const bits = bitsStr === undefined ? 128 : Number(bitsStr);
  if (!(bits >= 0 && bits <= 128)) throw new Error('gecersiz CIDR: ' + s);
  const mask = bits === 0 ? 0n : ((1n << 128n) - 1n) ^ ((1n << BigInt(128 - bits)) - 1n);
  return { fam: 6, net: ipv6ToBigInt(ip) & mask, mask: mask };
}

export function createNetGuard(spec) {
  const rules = String(spec || DEFAULT_CIDRS).split(',').map((s) => s.trim()).filter(Boolean).map(parseCidr);
  const warned = new Map();

  function allowed(rawAddr) {
    const a = normalize(rawAddr);
    const fam = a ? net.isIP(a) : 0;
    if (!fam) return false;
    for (const r of rules) {
      if (r.fam !== fam) continue;
      if (fam === 4) {
        if (((ipv4ToInt(a) & r.mask) >>> 0) === r.net) return true;
      } else if ((ipv6ToBigInt(a) & r.mask) === r.net) return true;
    }
    return false;
  }

  function logBlocked(rawAddr, label) {
    const a = normalize(rawAddr) || String(rawAddr);
    const last = warned.get(a) || 0;
    if (Date.now() - last > 60000) {
      warned.set(a, Date.now());
      if (warned.size > 200) warned.clear();
      console.warn('[netguard] engellendi (' + (label || 'genel') + '): ' + a);
    }
  }

  return { allowed, logBlocked, rules: rules.length };
}
