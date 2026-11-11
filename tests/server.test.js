import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { Game } from '../server/game.js';
import { SaveStore, migrate, NewerSaveError } from '../server/save.js';
import { startServer } from '../server/index.js';
import { DUNGEONS, ITEMS, PROTOCOL } from '../shared/content.js';
import * as R from '../shared/rules.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'emberdeep-'));
const fakeStore = { save() {} };

function join(game, name, cls = 'warrior') {
  const msgs = [];
  const p = game.addPlayer(R.newCharacter(name, cls), (m) => msgs.push(m));
  p.msgs = msgs;
  return p;
}
const run = (game, seconds) => { for (let i = 0; i < seconds * 20; i++) game.tick(0.05); };

test('save: round trip, backup fallback, migration, newer-version refusal', () => {
  const dir = tmp(), store = new SaveStore(dir);
  const ch = R.newCharacter('Saver', 'mage');
  ch.level = 7; ch.gold = 123; R.acceptQuest(ch, 'q_slimes'); R.onKill(ch, 'slime');
  store.save(ch);
  ch.gold = 456;
  store.save(ch);
  assert.equal(store.load('saver').gold, 456);
  assert.deepEqual(store.load('SAVER').quests, { q_slimes: { state: 'active', counts: [1] } });
  fs.writeFileSync(store.file('Saver'), '{"truncated');           // simulate a corrupt main file
  assert.equal(store.load('Saver').gold, 123, 'falls back to .bak');
  assert.equal(store.load('nobody'), null);

  const v1 = { version: 1, name: 'Old', cls: 'warrior', level: 3, xp: 5, gold: 9, inv: [{ id: 'hp_potion', n: 2 }, { id: 'removed_item', n: 1 }], equip: { weapon: 'c1_weapon_warrior' }, quests: {} };
  fs.writeFileSync(store.file('Old'), JSON.stringify(v1));
  const old = store.load('Old');
  assert.equal(old.version, R.SAVE_VERSION);
  assert.equal(old.inv.length, 30);
  assert.equal(old.pity, 0);
  assert.equal(old.inv[1], null, 'unknown items are dropped');
  assert.throws(() => migrate({ version: 999 }), NewerSaveError);
});

test('combat: killing an enemy grants xp, gold and quest progress; enemies respawn', () => {
  const game = new Game({ store: fakeStore, seed: 3 });
  const p = join(game, 'Hero');
  R.acceptQuest(p.ch, 'q_slimes');
  const slime = [...game.world.mobs].find((m) => m.mob === 'slime');
  const mobs = game.world.mobs.size;
  p.x = slime.x + 0.8; p.y = slime.y;
  let guard = 0;
  while (game.world.mobs.has(slime) && guard++ < 400) {
    game.attack(p, Math.atan2(slime.y - p.y, slime.x - p.x));
    game.tick(0.05);
  }
  assert.ok(!game.world.mobs.has(slime), 'slime dies');
  assert.ok(p.ch.xp > 0 || p.ch.level > 1);
  assert.ok(p.ch.gold > 20);
  assert.equal(p.ch.quests.q_slimes.counts[0], 1);
  assert.ok(p.msgs.some((m) => m.t === 's' && m.ev.some((e) => e.t === 'dmg')), 'damage events are replicated');
  p.x = 90.5; p.y = 72.5; // back to town so nothing else is fought
  run(game, 27);
  assert.equal(game.world.mobs.size, mobs, 'the camp respawned');
});

test('server authority: movement is clamped and blocked by terrain', () => {
  const game = new Game({ store: fakeStore, seed: 3 });
  const p = join(game, 'Speedy');
  const x0 = p.x;
  game.setMove(p, 1000, 0);
  run(game, 1);
  assert.ok(p.x - x0 <= p.stats.speed + 0.01, 'a huge input vector is normalised');
  game.setMove(p, NaN, 1);
  assert.equal(p.dx, 1, 'invalid input is ignored');
  p.x = 1.5; p.y = 70.5; game.setMove(p, -1, 0);
  run(game, 3);
  assert.ok(p.x >= 1, 'cannot walk off the map');
});

test('dungeons are level-gated, instanced per party, and bosses drop dungeon-only epics', () => {
  const game = new Game({ store: fakeStore, seed: 5 });
  const a = join(game, 'Alice'), b = join(game, 'Bob', 'mage'), c = join(game, 'Carol', 'ranger');
  const portal = [...game.world.ents.values()].find((e) => e.dungeon === 'crypt');
  a.x = portal.x; a.y = portal.y + 1;
  game.interact(a);
  assert.equal(a.inst, game.world, 'level 1 cannot enter');
  assert.ok(a.msgs.some((m) => m.t === 'chat' && /requires level 4/.test(m.text)));

  for (const p of [a, b, c]) { p.ch.level = 12; game.refresh(p); p.hp = p.stats.maxHp; p.x = portal.x; p.y = portal.y + 1; }
  game.chat(a, '/invite Bob');
  game.chat(b, '/accept');
  assert.equal(a.party, b.party);
  game.interact(a); game.interact(b); game.interact(c);
  assert.equal(a.inst.kind, 'dungeon');
  assert.equal(a.inst, b.inst, 'party members share one instance');
  assert.notEqual(a.inst, c.inst, 'other players get their own');
  assert.equal(a.ch.pos.x, DUNGEONS.crypt.x + 0.5, 'saved position is the entrance, not inside the instance');

  const inst = a.inst, boss = [...inst.mobs].find((m) => m.def.boss);
  const xp = [a.ch.xp, b.ch.xp];
  a.x = boss.x + 1; a.y = boss.y; b.x = boss.x - 1; b.y = boss.y;
  boss.hp = 1;
  game.attack(a, Math.PI);
  assert.ok(!inst.mobs.has(boss));
  assert.ok(a.ch.xp > xp[0] && b.ch.xp > xp[1], 'party members share xp');
  for (const p of [a, b]) {
    const epics = p.ch.inv.filter((s) => s && ITEMS[s.id].rarity === 'epic');
    assert.equal(epics.length, 1, 'personal epic loot for each member');
    assert.equal(ITEMS[epics[0].id].tier, 'd1e');
  }
  const exit = [...inst.ents.values()].filter((e) => e.exit);
  assert.equal(exit.length, 2, 'an exit appears where the boss fell');
  game.interact(a);
  assert.equal(a.inst, game.world);
});

test('open-world enemies never drop rare-or-better gear', () => {
  const game = new Game({ store: fakeStore, seed: 11 });
  const p = join(game, 'Farmer');
  const mob = [...game.world.mobs].find((m) => m.spawn.zone === 'frost');
  for (let i = 0; i < 3000; i++) { p.ch.inv.fill(null); game.rollLoot(p, mob, game.world); for (const s of p.ch.inv) if (s) assert.ok(['common', 'uncommon'].includes(ITEMS[s.id].rarity)); }
});

test('boss slam is telegraphed and can be dodged', () => {
  const game = new Game({ store: fakeStore, seed: 8 });
  const p = join(game, 'Dodger');
  p.ch.level = 10; game.refresh(p); p.hp = p.stats.maxHp;
  game.enterDungeon(p, 'crypt');
  const inst = p.inst, boss = [...inst.mobs].find((m) => m.def.boss);
  p.x = boss.x + 1.5; p.y = boss.y;
  p.msgs.length = 0;
  let tele = null, guard = 0;
  while (!tele && guard++ < 100) { game.tick(0.05); tele = p.msgs.flatMap((m) => (m.t === 's' ? m.ev : [])).find((e) => e.t === 'tele'); }
  assert.ok(tele, 'slam is announced before it lands');
  p.x = boss.x + 4.5; // step out of the circle
  const hp = p.hp;
  run(game, tele.d + 0.2);
  assert.ok(p.msgs.flatMap((m) => (m.t === 's' ? m.ev : [])).some((e) => e.t === 'slam'));
  assert.equal(Math.round(p.hp), Math.round(hp), 'no damage outside the telegraph');
});

test('network: two real clients log in, see each other, chat; bad input is rejected; progress persists', async () => {
  const dir = tmp();
  let srv = await startServer({ port: 0, dataDir: dir, seed: 1 });
  const connect = () => new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${srv.port}/ws`), msgs = [];
    ws.on('message', (d) => msgs.push(JSON.parse(d)));
    ws.on('open', () => resolve({ ws, msgs, send: (m) => ws.send(JSON.stringify(m)) }));
  });
  const until = async (c, pred) => { for (let i = 0; i < 200; i++) { const m = c.msgs.find(pred); if (m) return m; await new Promise((r) => setTimeout(r, 20)); } throw new Error('timed out'); };

  const a = await connect(), b = await connect(), bad = await connect();
  bad.send({ t: 'login', v: PROTOCOL + 1, name: 'Zed', pass: 'hunter2', cls: 'mage' });
  assert.match((await until(bad, (m) => m.t === 'error')).msg, /out of date/);
  bad.msgs.length = 0;
  bad.send({ t: 'login', v: PROTOCOL, name: '<script>', pass: 'hunter2', cls: 'mage' });
  await until(bad, (m) => m.t === 'error');
  bad.ws.send('not json'); bad.send({ t: 'move', dx: 1, dy: 0 }); // ignored before login

  a.send({ t: 'login', v: PROTOCOL, name: 'Ann', pass: 'hunter2', cls: 'warrior' });
  b.send({ t: 'login', v: PROTOCOL, name: 'Ben', pass: 'hunter2', cls: 'ranger' });
  const youA = await until(a, (m) => m.t === 'you');
  assert.equal(youA.level, 1);
  assert.ok((await until(a, (m) => m.t === 'map')).tiles.length > 1000);
  await until(b, (m) => m.t === 'you');
  await until(a, (m) => m.t === 's' && m.e.some((e) => e.k === 'p' && e.n === 'Ben'));
  a.send({ t: 'chat', text: 'hello world' });
  assert.equal((await until(b, (m) => m.t === 'chat' && m.from === 'Ann')).text, 'hello world');
  const x0 = (await until(a, (m) => m.t === 's')).x;
  a.send({ t: 'move', dx: 1, dy: 0 });
  await until(a, (m) => m.t === 's' && m.x > x0 + 0.5);
  a.send({ t: 'move', dx: 0, dy: 0 });

  bad.msgs.length = 0;
  bad.send({ t: 'login', v: PROTOCOL, name: 'Ann', pass: 'wrong-password', cls: 'mage' });
  assert.match((await until(bad, (m) => m.t === 'error')).msg, /Wrong password/);

  srv.game.players.get('ann').ch.gold = 777;
  await srv.close();
  srv = await startServer({ port: 0, dataDir: dir, seed: 1 });
  const a2 = await connect();
  a2.send({ t: 'login', v: PROTOCOL, name: 'Ann', pass: 'hunter2' });
  const you = await until(a2, (m) => m.t === 'you');
  assert.equal(you.gold, 777);
  assert.equal(you.cls, 'warrior');
  assert.ok((await until(a2, (m) => m.t === 'map')).x > x0 + 0.5, 'position was saved');
  await srv.close();
});

test('looks: chosen at creation, validated, migrated for old saves, changeable only at the wardrobe', async () => {
  assert.deepEqual(R.normalizeLook([1, 9, -1, 'x'], 'ranger'), [1, 1, 1, 1, 1, 1, 1, 0], 'bad entries fall back to the class default');
  assert.deepEqual(R.newCharacter('A', 'mage', [0, 1, 0, 1, 0, 1, 3, 2]).look, [0, 1, 0, 1, 0, 1, 3, 2]);

  const dir = tmp(), store = new SaveStore(dir);
  fs.writeFileSync(store.file('Oldie'), JSON.stringify({ version: 2, name: 'Oldie', cls: 'mage', level: 2, xp: 0, gold: 1, inv: [], equip: {}, quests: {}, pity: 0 }));
  assert.deepEqual(store.load('Oldie').look, [1, 0, 0, 0, 0, 0, 2, 0], 'pre-look saves get their class look');

  const game = new Game({ store: fakeStore, seed: 2 });
  const p = join(game, 'Dresser', 'warrior');
  game.setLook(p, [0, 1, 1, 1, 1, 1, 5, 1]);
  assert.deepEqual(p.ch.look, [0, 0, 0, 0, 0, 0, 0, 0], 'refused away from the merchant');
  p.x = 93.5; p.y = 69;
  game.setLook(p, [0, 1, 1, 1, 1, 1, 5, 1]);
  assert.deepEqual(p.ch.look, [0, 1, 1, 1, 1, 1, 5, 1]);
  p.ch.equip.chest = 'd1e_chest';
  const other = join(game, 'Watcher');
  other.x = p.x + 1; other.y = p.y;
  game.tick(0.05); game.tick(0.05);
  const seen = other.msgs.filter((m) => m.t === 's').pop().e.find((e) => e.n === 'Dresser');
  assert.deepEqual(seen.lk, [0, 1, 1, 1, 1, 1, 5, 1], 'others see the outfit');
  assert.equal(seen.gr, 'c-e-', 'and the rarity of the worn gear');
});
