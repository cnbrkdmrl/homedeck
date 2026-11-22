# HomeDeck

Boştaki bir tableti ya da eski bir telefonu sürekli açık bir ev sunucusu ekranına çeviren, sıfır bağımlılıklı (Node 20+) panel hub'ı. SSE ile canlı veri, eski WebView'larda çalışan sade JS arayüz, sürükle-bırak yerleşim editörü, Docker ile kurulum.

> Arayüz Türkçedir. İngilizce doküman: [README.md](README.md).

## Özellikler

- **Makineler:** her makinede çalışan küçük agent CPU, RAM, diskler, ağ, sıcaklık, (varsa) GPU ve pil bilgisini gönderir (macOS / Linux / Windows).
- **Docker** konteyner listesi (salt okunur socket proxy), **sistem** metrikleri, **modem** trafik sayacı (UPnP/IGD).
- **Hava, güneş/ay, hava kalitesi** (Open-Meteo, anahtarsız); **takvim** ve **akıllı ev cihazları** Home Assistant üzerinden (salt okunur).
- **Piyasa:** döviz, kripto, altın (Türk kaynakları + PAXG), Hacker News. Hepsi anahtarsız herkese açık API; kapatmak için `MARKET=off`.
- **AI araçları:** Claude Code oturum kancaları (çalışıyor / bekliyor / boşta) ve AI kota çubukları.
- **Gitea paneli** (son commit'ler + CI) ve **webhook** (`POST /api/push`): kendi script'lerinden ekrana değer/bildirim gönder.
- **Smart Stack**, sıradaki etkinlik, dünya saatleri, kelime saati ve iPhone tarzı **yerleşim editörü**.
- **Ağ kilidi:** izleyici ve veri girişi için ayrı izin listeleri, makine başına token.

## Hızlı başlangıç

```bash
npm start            # http://localhost:8787
```

macOS/Windows'ta sistem metrikleri ve Docker **simüle** edilir ("demo" etiketi). Linux'ta gerçek veri gelir. Demo anahtarları: `DEMO_SESSIONS=1`, `DEMO_QUOTAS=1`, `DEMO_CALENDAR=1`, `DEMO_HA=1`, `DEMO_MODEM=1`.

## Docker ile kurulum

```bash
cp .env.example .env     # SERVER_TOKEN, VIEWER_IP, EDIT_PIN ... doldur
docker compose up -d --build
```

Ekran cihazında `http://<sunucu-ip>:8787` aç. Compose hub'ı, salt okunur `docker-socket-proxy`'yi ve sunucunun kendi agent'ını (`agent-server`) çalıştırır.

## Ayarlar

Tüm ayarlar ortam değişkenidir: [`.env.example`](.env.example) ve [`docker-compose.yml`](docker-compose.yml). Başlıcalar: `SERVER_TOKEN` (zorunlu), `VIEWER_IP` (ekran cihazının sabit IP'si; arayüzü yalnız o görür), `EDIT_PIN` (boşsa düzenleme kapalı), `EXTRA_AGENT_TOKENS` (`,laptop:token,desktop:token`), `VIEWER_EXTRA`, `WEATHER_CITY/LAT/LON`, `HA_URL/HA_TOKEN`, `GITEA_URL/GITEA_REPOS/GITEA_TOKEN`, `MODEM_UPNP`, `PUSH_TOKEN`, `ACCESS_TOKEN` (LAN dışına açacaksan zorunlu).

## Makine ekleme

```bash
./agent/install-macos.sh http://<sunucu-ip>:8787 <TOKEN> laptop "Laptop"
```

```powershell
powershell -ExecutionPolicy Bypass -File .\install-windows.ps1 -Hub http://<sunucu-ip>:8787 -Token <TOKEN> -HostId desktop -Label "Desktop"
```

`laptop:<TOKEN>` değerini `EXTRA_AGENT_TOKENS`'a ekle. Windows güncelleme: [`agent/WINDOWS-UPDATE.txt`](agent/WINDOWS-UPDATE.txt).

## Webhook

```bash
curl -X POST http://<sunucu-ip>:8787/api/push \
  -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \
  -d '{"id":"yedek","label":"Yedek","value":"OK","sub":"2 dk önce","level":"ok"}'
```

Değerler `id`'ye göre tutulur; bildirimler `ttl` dakika sonra düşer (varsayılan 60).

## Claude Code kancaları ve kota

`node hooks/install-hooks.mjs --dry-run` ile önce ne yapacağını gör, sonra `node hooks/install-hooks.mjs` ile kur. Makinede agent kurulu olmalı. Claude kotası için OAuth yöntemi **resmi olmayan, belgelenmemiş** bir uç nokta kullanır; varsayılan **kapalı**. Açmadan önce `agent/claude-usage.mjs` içindeki notları oku.

## Yerleşim editörü

Widget'a ~0,5 sn basılı tut, PIN'i gir; sürükle, dokun-boyutlandır, `＋ Widget` ile ekle, `−` ile kaldır. Değişiklikler otomatik kaydedilir (`data/backups` içinde son 10 yedek). `?profile=ad` ile cihaz başına ayrı düzen. Varsayılan düzen: [`config/layout.json`](config/layout.json).

## Güvenlik

İzleyici ve veri girişi listeleri ayrıdır; diğer adresler `403` alır. `docker.sock` yalnız salt okunur proxy'den erişilir. Sırlar hub ortamında kalır, ekrana gitmez. PIN zayıf bir korumadır: HomeDeck'i LAN/VPN içinde tut; başka yere açacaksan `ACCESS_TOKEN` ayarla.

## Lisans

[MIT](LICENSE). Kota yöntemi [PhoneBox](https://github.com/ersinkoc/phonebox)'tan (MIT) uyarlanmıştır.
