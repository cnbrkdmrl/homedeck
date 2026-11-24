// macOS: calan sarkiyi oku ve kontrol et (Muzik/Apple Music ve Spotify masaustu uygulamalari; AppleScript, anahtar gerekmez).
// Uygulama calismiyorsa ona DOKUNMAZ (AppleScript uygulamayi acabilir): once pgrep -x ile bakilir.
// Ilk kullanimda macOS "node/osascript, Muzik'i kontrol etmek istiyor" diye izin sorar: Izin Ver. (Sistem Ayarlari > Gizlilik ve Guvenlik > Otomasyon)
import { execFile } from 'node:child_process';

const APPS = [
  { id: 'music', name: 'Music' },
  { id: 'spotify', name: 'Spotify' },
];
const VERB = { playpause: 'playpause', next: 'next track', previous: 'previous track' };

function exec(cmd, args, timeout = 2500) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, maxBuffer: 256 * 1024 }, (err, out, errOut) => resolve({ err, out: String(out || ''), errOut: String(errOut || '') }));
  });
}

// AppleScript: calan parca bilgisi, sekmeyle ayrilmis tek satir. Alan hatalari (radyo vb.) bos birakilir.
function script(appName, withArt) {
  return [
    'tell application "' + appName + '"',
    '  if player state is stopped then return "stopped"',
    '  set stateText to "paused"',
    '  if player state is playing then set stateText to "playing"',
    '  set trk to current track',
    '  set trkName to ""',
    '  set trkArtist to ""',
    '  set trkAlbum to ""',
    '  set trkDur to 0',
    '  set trkArt to ""',
    '  set trkPos to 0',
    '  try',
    '    set trkName to name of trk',
    '  end try',
    '  try',
    '    set trkArtist to artist of trk',
    '  end try',
    '  try',
    '    set trkAlbum to album of trk',
    '  end try',
    '  try',
    '    set trkDur to round (duration of trk)',
    '  end try',
    withArt ? '  try\n    set trkArt to artwork url of trk\n  end try' : '',
    '  try',
    '    set trkPos to round (player position)',
    '  end try',
    '  return stateText & tab & trkName & tab & trkArtist & tab & trkAlbum & tab & trkDur & tab & trkPos & tab & trkArt',
    'end tell',
  ].filter(Boolean).join('\n');
}

// AppleScript ciktisi -> medya nesnesi (saf fonksiyon, test edilir). Spotify suresi ms, Muzik'inki sn.
export function parseTrack(appId, text) {
  const t = String(text || '').replace(/\n$/, '');
  if (!t || t === 'stopped') return null;
  const f = t.split('\t');
  const state = f[0] === 'playing' ? 'playing' : f[0] === 'paused' ? 'paused' : null;
  if (!state || !f[1]) return null;
  const num = (s) => { const v = Number(String(s || '').replace(',', '.')); return isFinite(v) && v >= 0 ? v : null; };
  let dur = num(f[4]);
  if (appId === 'spotify' && dur !== null) dur = dur / 1000;
  return { app: appId, state, title: f[1], artist: f[2] || '', album: f[3] || '', duration: dur, position: num(f[5]), artwork: f[6] || null };
}

export function createMedia({ platform, log }) {
  if (platform !== 'darwin') return null;
  let last = null;      // en son raporlanan uygulama (komut buna gider)
  let hinted = false;

  async function running(app) { return (await exec('pgrep', ['-x', app.name], 1500)).out.trim() !== ''; }

  async function readApp(app) {
    if (!(await running(app))) return null;
    const r = await exec('osascript', ['-e', script(app.name, app.id === 'spotify')]);
    if (r.err) {
      if (!hinted && /-1743|not allowed|not authori/i.test(r.errOut)) {
        hinted = true;
        log('[agent] medya: ' + app.name + ' icin Otomasyon izni yok. Sistem Ayarlari > Gizlilik ve Guvenlik > Otomasyon\'da izin ver.');
      }
      return null;
    }
    return parseTrack(app.id, r.out);
  }

  return {
    // Calan (yoksa duraklatilmis) parca ya da null
    async read() {
      const found = [];
      for (const app of APPS) { const m = await readApp(app); if (m) found.push(m); }
      const pick = found.find((m) => m.state === 'playing') || found.find((m) => m.app === last) || found[0] || null;
      last = pick ? pick.app : last;
      return pick;
    },
    async control(action) {
      const verb = VERB[action];
      if (!verb) return false;
      const order = last ? [APPS.find((a) => a.id === last), ...APPS.filter((a) => a.id !== last)] : APPS;
      for (const app of order) {
        if (!(await running(app))) continue;
        const r = await exec('osascript', ['-e', 'tell application "' + app.name + '" to ' + verb]);
        if (!r.err) return true;
      }
      return false;
    },
  };
}
