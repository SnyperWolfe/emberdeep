// HTTP static file server + WebSocket gateway for the Emberdeep game server.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { PROTOCOL, CLASSES } from '../shared/content.js';
import { newCharacter } from '../shared/rules.js';
import { Game } from './game.js';
import { SaveStore, hashPassword, checkPassword } from './save.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.glb': 'model/gltf-binary', '.md': 'text/markdown; charset=utf-8' };
const STATIC = [
  ['/vendor/three/build/', path.join(ROOT, 'node_modules/three/build') + path.sep],
  ['/vendor/three/examples/jsm/', path.join(ROOT, 'node_modules/three/examples/jsm') + path.sep],
  ['/shared/', path.join(ROOT, 'shared') + path.sep],
  ['/', path.join(ROOT, 'client') + path.sep],
];
const NAME_RE = /^[A-Za-z][A-Za-z0-9_]{2,13}$/;
const TICK_MS = 50;

function resolveStatic(urlPath) {
  for (const [prefix, target] of STATIC) {
    if (!urlPath.startsWith(prefix)) continue;
    if (!prefix.endsWith('/')) return urlPath === prefix ? target : null;
    const file = path.resolve(target, urlPath.slice(prefix.length) || 'index.html');
    return file.startsWith(target) ? file : null; // no escaping the served directory
  }
  return null;
}

export function startServer({ port = 8080, dataDir = path.join(ROOT, 'data'), seed, tick = true } = {}) {
  const store = new SaveStore(dataDir);
  const game = new Game({ store, seed });

  const server = http.createServer((req, res) => {
    let file = null;
    try { file = resolveStatic(decodeURIComponent(new URL(req.url, 'http://x').pathname)); } catch { /* bad URL */ }
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': file.includes(`${path.sep}node_modules${path.sep}`) || file.endsWith('.glb') ? 'public, max-age=86400' : 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });

  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
  wss.on('connection', (ws) => {
    let player = null, busy = false, failures = 0;
    let tokens = 60, last = Date.now(); // token bucket: 60 messages/second, burst 60
    const send = (msg) => { if (ws.readyState === ws.OPEN && ws.bufferedAmount < 1 << 20) ws.send(JSON.stringify(msg)); };

    async function login(m) {
      if (m.v !== PROTOCOL) return send({ t: 'error', msg: 'Client is out of date. Reload the page.' });
      const name = String(m.name || ''), pass = String(m.pass || '');
      if (!NAME_RE.test(name)) return send({ t: 'error', msg: 'Name must be 3-14 letters, digits or _ and start with a letter.' });
      if (pass.length < 4 || pass.length > 64) return send({ t: 'error', msg: 'Password must be 4-64 characters.' });
      let acc;
      try { acc = store.load(name); } catch (err) { console.error(`load failed for ${name}:`, err.message); return send({ t: 'error', msg: 'That character could not be loaded.' }); }
      if (acc) {
        if (!(await checkPassword(pass, acc.auth))) {
          if (++failures >= 5) ws.close();
          return send({ t: 'error', msg: 'Wrong password (or that name is taken).' });
        }
      } else {
        if (!CLASSES[m.cls]) return send({ t: 'error', msg: 'Choose a class to create a new character.' });
        acc = newCharacter(name, m.cls, m.look);
        acc.auth = await hashPassword(pass);
        store.save(acc);
      }
      if (ws.readyState !== ws.OPEN) return;
      player = game.addPlayer(acc, send);
      player.onKick = () => { player = null; ws.close(); };
    }

    ws.on('message', async (raw) => {
      const t = Date.now();
      tokens = Math.min(60, tokens + ((t - last) / 1000) * 60); last = t;
      if (--tokens < 0) return ws.close(1008, 'rate limit');
      let m;
      try { m = JSON.parse(raw.toString()); } catch { return; }
      if (!m || typeof m !== 'object') return;
      if (!player) {
        if (m.t !== 'login' || busy) return;
        busy = true;
        try { await login(m); } finally { busy = false; }
        return;
      }
      switch (m.t) {
        case 'move': return game.setMove(player, +m.dx, +m.dy);
        case 'attack': return game.attack(player, +m.a);
        case 'skill': return game.skill(player, m.i | 0, +m.a);
        case 'potion': return game.usePotion(player, m.k);
        case 'equip': return game.equip(player, m.slot);
        case 'unequip': return game.unequip(player, String(m.slot));
        case 'buy': return game.buy(player, String(m.id));
        case 'sell': return game.sell(player, m.slot, !!m.all);
        case 'quest': return game.quest(player, m.op, String(m.id));
        case 'look': return game.setLook(player, m.look);
        case 'interact': return game.interact(player);
        case 'chat': return game.chat(player, m.text);
        case 'ping': return send({ t: 'pong', c: m.c });
        default:
      }
    });
    ws.on('close', () => { if (player) game.removePlayer(player); player = null; });
    ws.on('error', () => {});
  });

  let prev = Date.now();
  const loop = tick && setInterval(() => {
    const now = Date.now(), dt = Math.min(0.25, (now - prev) / 1000);
    prev = now;
    game.tick(dt);
  }, TICK_MS);
  const autosave = setInterval(() => game.saveAll(), 30000);

  const close = () => new Promise((resolve) => {
    clearInterval(loop); clearInterval(autosave);
    game.saveAll();
    for (const c of wss.clients) c.terminate();
    wss.close(() => server.close(resolve));
  });
  return new Promise((resolve) => server.listen(port, () => resolve({ server, game, close, port: server.address().port })));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 8080;
  const s = await startServer({ port, dataDir: process.env.EMBERDEEP_DATA });
  console.log(`Emberdeep running at http://localhost:${s.port}`);
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => s.close().then(() => process.exit(0)));
}
