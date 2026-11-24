import system from './system.js';
import docker from './docker.js';
import weather from './weather.js';
import air from './air.js';
import calendar from './calendar.js';
import { mockCalendar } from './mock-calendar.js';
import haDevices from './homeassistant.js';
import { mockHa } from './mock-ha.js';
import modem from './modem.js';
import { mockModem } from './mock-modem.js';
import gitea from './gitea.js';
import { fx, crypto, hn, gold } from './market.js';
import services, { hasServices } from './services.js';
import { mockQuotas, mockSessions } from './mock-ai.js';

// Yeni veri kaynagi eklemek icin: collectors/ altina { name, interval, run() } dosyasi yaz, buraya ekle.
// AI oturumlari ve AI kotalari collector degil: agent'lar/kancalar POST ile gonderir (server/sessions.js, server/quotas.js).
// Gelistirirken ornek veri icin: DEMO_SESSIONS=1, DEMO_QUOTAS=1
export const collectors = [system, docker, weather, air];
// Takvim: Home Assistant'tan (HA_URL + HA_TOKEN .env'de). Jeton yoksa kayit edilmez. Gelistirmede ornek veri: DEMO_CALENDAR=1
if (process.env.DEMO_CALENDAR === '1') collectors.push(mockCalendar);
else if (process.env.HA_TOKEN) collectors.push(calendar);
// Home Assistant cihazlari (hava temizleyici, supurge, kombi; yalniz okuma): ayni HA_URL/HA_TOKEN. Gelistirmede: DEMO_HA=1
if (process.env.DEMO_HA === '1') collectors.push(mockHa);
else if (process.env.HA_TOKEN) collectors.push(haDevices);
// Modem sayaci (UPnP/IGD, sifresiz, salt okunur). Yalniz MODEM_UPNP=http://MODEM_IP:PORT ayarliysa acilir. Gelistirmede: DEMO_MODEM=1
if (process.env.DEMO_MODEM === '1') collectors.push(mockModem);
else if (process.env.MODEM_UPNP && process.env.MODEM_UPNP !== 'off') collectors.push(modem);
// Gitea paneli (son commit'ler + CI, salt okunur): GITEA_URL + GITEA_TOKEN + GITEA_REPOS ayarliysa
if (process.env.GITEA_URL && process.env.GITEA_TOKEN && process.env.GITEA_REPOS) collectors.push(gitea);
// Doviz, kripto, Hacker News (anahtarsiz herkese acik API'ler). Kapatmak icin MARKET=off
if (process.env.MARKET !== 'off') collectors.push(fx, crypto, hn, gold);
// Servis kontrolu (ayakta mi + yanit suresi): SERVICES="Ad=http://host:port,Ad2=tcp://host:port" ayarliysa
if (hasServices) collectors.push(services);
if (process.env.DEMO_QUOTAS === '1') collectors.push(mockQuotas);
if (process.env.DEMO_SESSIONS === '1') collectors.push(mockSessions);
