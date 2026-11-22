// Gelistirme icin ornek Home Assistant verisi (DEMO_HA=1): temizleyici + supurge + kombi. Gercek veri gelmez.
export const mockHa = {
  name: 'ha',
  interval: 15 * 1000,
  async run() {
    const t = Date.now() / 1000;
    return {
      data: {
        fans: [{ id: 'fan.demo', name: 'zhimi.airpurifier.mc2', on: true, unavailable: false, percentage: 60, mode: 'Auto',
          sensors: { pm25: Math.round(18 + 12 * Math.sin(t / 30)), humidity: 52, temperature: 22.9, filterLeft: 4, filterHours: 3200, rpm: 910 } }],
        vacuums: [{ id: 'vacuum.demo', name: 'Robot', state: 'cleaning', battery: 63, fanSpeed: 'Turbo', status: 'Salon' }],
        climates: [
          { id: 'climate.demo', kind: 'climate', name: 'Ev', mode: 'heat', action: 'heating', current: 20.5, target: 22, humidity: 49.4, preset: 'home' },
          { id: 'water_heater.demo', kind: 'water', name: 'Sıcak su', mode: 'on', action: null, current: 48, target: 55, humidity: null, preset: null },
        ],
      },
      simulated: true,
    };
  },
};
