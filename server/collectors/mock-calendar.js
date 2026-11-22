// Gelistirme icin ornek takvim (DEMO_CALENDAR=1). Gercek veri gelmez.
const H = 3600000;
export const mockCalendar = {
  name: 'calendar',
  interval: 60 * 1000,
  async run() {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const ds = (off) => { const d = new Date(midnight + off * 86400000); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
    const t = (off, h, m) => midnight + off * 86400000 + (h + (m || 0) / 60) * H;
    const ev = (id, cal, title, o) => Object.assign({ id, cal, title, location: null, allDay: false }, o);
    const events = [
      ev('1', 'calendar.kisisel', 'Sabah koşusu', { start: t(0, 7), end: t(0, 8) }),
      ev('2', 'calendar.kisisel', 'Ekip toplantısı', { start: now.getTime() - 20 * 60000, end: now.getTime() + 40 * 60000, location: 'Zoom' }),
      ev('3', 'calendar.aile', 'Akşam yemeği', { start: t(0, 19, 30), end: t(0, 22), location: 'Restoran' }),
      ev('4', 'calendar.kisisel', 'Diş randevusu', { start: t(1, 10, 15), end: t(1, 11), location: 'Klinik' }),
      ev('5', 'calendar.aile', 'Doğum günü', { allDay: true, date: ds(2), endDate: ds(3) }),
      ev('6', 'calendar.kisisel', 'Kargo teslimi', { start: t(2, 14), end: t(2, 15) }),
      ev('7', 'calendar.aile', 'Tatil', { allDay: true, date: ds(4), endDate: ds(7) }),
      ev('8', 'calendar.kisisel', 'Proje sunumu', { start: t(5, 9), end: t(5, 10, 30) }),
    ];
    return {
      data: { calendars: [{ id: 'calendar.kisisel', name: 'Kişisel' }, { id: 'calendar.aile', name: 'Aile' }], events, failed: [] },
      simulated: true,
    };
  },
};
