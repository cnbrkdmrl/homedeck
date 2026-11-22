// Gelistirme icin ornek modem verisi (DEMO_MODEM=1). Gercek veri gelmez.
const hist = { rx: [], tx: [] };
export const mockModem = {
  name: 'modem',
  interval: 3000,
  async run() {
    const t = Date.now() / 1000;
    const rx = Math.max(0, 180 + 140 * Math.sin(t / 15) + 40 * Math.sin(t / 3));
    const tx = Math.max(0, 22 + 15 * Math.sin(t / 11));
    hist.rx.push(+rx.toFixed(2)); hist.tx.push(+tx.toFixed(2));
    if (hist.rx.length > 90) { hist.rx.shift(); hist.tx.shift(); }
    return { data: { rx, tx, todayRx: 14.2e9, todayTx: 2.6e9, day: '2026-11-14', hist: { rx: hist.rx.slice(), tx: hist.tx.slice() }, link: 'Up' }, simulated: true };
  },
};
