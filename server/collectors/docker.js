// Docker durumu. DOCKER_HOST=tcp://127.0.0.1:2375 (docker-socket-proxy, onerilen) ya da unix socket.
import http from 'node:http';
import fs from 'node:fs';

const SOCKET = process.env.DOCKER_SOCKET || '/var/run/docker.sock';
const HOST = process.env.DOCKER_HOST || '';

function target() {
  if (HOST.startsWith('tcp://')) {
    const u = new URL(HOST.replace('tcp://', 'http://'));
    return { host: u.hostname, port: Number(u.port || 2375) };
  }
  if (fs.existsSync(SOCKET)) return { socketPath: SOCKET };
  return null;
}

function get(opts, p) {
  return new Promise((resolve, reject) => {
    const req = http.request({ ...opts, path: p, method: 'GET', timeout: 4000 }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error('docker http ' + res.statusCode));
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('docker timeout')));
    req.on('error', reject);
    req.end();
  });
}

function mock() {
  const names = [
    ['jellyfin', 'running'],
    ['homeassistant', 'running'],
    ['gitea', 'running'],
    ['glances', 'running'],
    ['ollama', 'running'],
    ['nextcloud', 'exited'],
    ['uptime-kuma', 'running'],
  ];
  return names.map(([name, state]) => ({
    name,
    state,
    status: state === 'running' ? 'Up 3 days' : 'Exited (0) 2 hours ago',
    image: name + ':latest',
  }));
}

export default {
  name: 'docker',
  interval: 5000,
  async run() {
    const t = target();
    if (!t) return { data: { containers: mock() }, simulated: true };
    const list = await get(t, '/containers/json?all=1');
    const containers = list.map((c) => ({
      name: (c.Names[0] || '').replace(/^\//, ''),
      state: c.State,
      status: c.Status,
      image: c.Image,
    }));
    return { data: { containers }, simulated: false };
  },
};
