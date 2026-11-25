// PIN doğrulama (sabit zamanlı karşılaştırma + deneme sınırı). Düzenleme ve onaylar aynı sayaçı paylaşır,
// böylece iki ayrı yerden deneyerek sınır ikiye katlanamaz.
import crypto from 'node:crypto';

const MAX_FAILS = 5;
const LOCK_MS = 60000;

export function createPinGuard(pin) {
  const want = Buffer.from(String(pin === undefined || pin === null ? '' : pin));
  let fails = 0;
  let lockedUntil = 0;
  return {
    enabled: want.length > 0,
    // 'ok' | 'bad' | 'locked' | 'disabled'
    check(given) {
      if (!want.length) return 'disabled';
      if (Date.now() < lockedUntil) return 'locked';
      const g = Buffer.from(String(given || ''));
      const ok = g.length === want.length && crypto.timingSafeEqual(g, want);
      if (!ok) {
        fails++;
        if (fails >= MAX_FAILS) { lockedUntil = Date.now() + LOCK_MS; fails = 0; }
        return 'bad';
      }
      fails = 0;
      return 'ok';
    },
  };
}
