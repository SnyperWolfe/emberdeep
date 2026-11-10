import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../shared/rng.js';
import { ITEMS, TIERS, RARITY, DUNGEONS, ZONES, QUESTS, ENEMIES, CLASSES, MAX_LEVEL, isWalkable, tierItems } from '../shared/content.js';
import * as R from '../shared/rules.js';
import { genOverworld, genDungeon, floodFill } from '../shared/mapgen.js';
import { findPath } from '../shared/path.js';

test('stats are derived from level and gear, and unequipping restores them exactly', () => {
  const ch = R.newCharacter('Tester', 'warrior');
  const before = R.derive(ch);
  R.addItem(ch, 'u1_helm');
  const slot = R.findItem(ch, 'u1_helm');
  ch.level = 5;
  assert.equal(R.equip(ch, slot), null);
  assert.ok(R.derive(ch).defense > R.derive({ ...ch, equip: { ...ch.equip, helm: null } }).defense);
  assert.equal(R.unequip(ch, 'helm'), null);
  ch.level = 1;
  assert.deepEqual(R.derive(ch), before);
});

test('gear rules: class and level requirements', () => {
  const ch = R.newCharacter('Tester', 'mage');
  R.addItem(ch, 'c2_weapon_warrior');
  R.addItem(ch, 'd3e_chest');
  assert.match(R.equip(ch, R.findItem(ch, 'c2_weapon_warrior')), /Warrior/);
  assert.match(R.equip(ch, R.findItem(ch, 'd3e_chest')), /level/);
});

test('xp curve: early levels are fast, later ones longer, capped at max level', () => {
  assert.ok(R.xpToNext(1) < R.xpToNext(2) && R.xpToNext(10) > 10 * R.xpToNext(1));
  const ch = R.newCharacter('Tester', 'ranger');
  assert.equal(R.gainXp(ch, R.xpToNext(1) + R.xpToNext(2)), 2);
  assert.equal(ch.level, 3);
  R.gainXp(ch, 1e9);
  assert.equal(ch.level, MAX_LEVEL);
  assert.equal(ch.xp, 0);
});

test('damage: mitigation never makes a target immune, and defense reduces damage', () => {
  const rng = makeRng(1);
  for (let i = 0; i < 200; i++) assert.ok(R.rollDamage(rng, 1, 1, 99999).dmg >= 1);
  const avg = (def) => { const r = makeRng(7); let s = 0; for (let i = 0; i < 500; i++) s += R.rollDamage(r, 100, 1, def).dmg; return s / 500; };
  assert.ok(Math.abs(avg(60) - 50) < 3, 'defense == K halves damage');
});

test('inventory stacks potions and reports overflow', () => {
  const ch = R.newCharacter('Tester', 'warrior');
  assert.equal(R.addItem(ch, 'hp_potion', 17), 0);
  assert.equal(ch.inv.filter(Boolean).length, 1);
  assert.equal(ch.inv[0].n, 20);
  for (let i = 0; i < 40; i++) R.addItem(ch, 'c1_helm');
  assert.equal(R.freeSlots(ch), 0);
  assert.equal(R.addItem(ch, 'c1_helm'), 1);
  assert.match(R.unequip(ch, 'chest'), /full/);
});

test('quest state machine: accept -> progress -> complete -> turn in once', () => {
  const ch = R.newCharacter('Tester', 'warrior');
  assert.equal(R.questStatus(ch, QUESTS[1]), 'locked');
  assert.equal(R.acceptQuest(ch, 'q_slimes'), null);
  assert.ok(R.acceptQuest(ch, 'q_slimes'));
  for (let i = 0; i < 5; i++) R.onKill(ch, 'slime');
  assert.equal(ch.quests.q_slimes.state, 'active');
  assert.ok(R.turnInQuest(ch, 'q_slimes').error);
  R.onKill(ch, 'slime');
  assert.equal(ch.quests.q_slimes.state, 'complete');
  const gold = ch.gold;
  assert.equal(R.turnInQuest(ch, 'q_slimes').error, undefined);
  assert.equal(ch.gold, gold + 25);
  assert.ok(R.turnInQuest(ch, 'q_slimes').error, 'rewards are granted once');
  assert.equal(R.questStatus(ch, QUESTS[1]), 'available');
});

test('content is consistent: every reference resolves', () => {
  for (const q of QUESTS) {
    for (const o of q.objectives) assert.ok(ENEMIES[o.target], `${q.id} -> ${o.target}`);
    for (const [id] of q.rewards.items || []) assert.ok(ITEMS[id], `${q.id} -> ${id}`);
  }
  for (const z of ZONES) for (const [m] of z.mobs || []) assert.ok(ENEMIES[m]);
  for (const d of Object.values(DUNGEONS)) {
    assert.ok(ENEMIES[d.boss].boss);
    for (const [m] of d.mobs) assert.ok(ENEMIES[m].elite);
    for (const cls of Object.keys(CLASSES)) assert.ok(tierItems(d.epic, cls).length >= 5);
  }
});

test('the best gear only comes from dungeons', () => {
  const power = (i) => i.ilvl * RARITY[i.rarity].mult;
  for (const cls of Object.keys(CLASSES)) {
    for (const slot of ['weapon', 'chest', 'helm', 'boots', 'ring']) {
      const pool = Object.values(ITEMS).filter((i) => i.slot === slot && (!i.cls || i.cls === cls));
      const best = pool.reduce((a, b) => (power(b) > power(a) ? b : a));
      assert.equal(best.source, 'dungeon', `${cls} ${slot}`);
    }
  }
  // Each dungeon's boss gear beats everything in the open-world zone it sits in and the next one.
  const world = ['u1', 'u2', 'u3', 'u4'].map((t) => TIERS[t].ilvl * RARITY.uncommon.mult);
  assert.ok(TIERS.d1e.ilvl * RARITY.epic.mult > world[2]);
  assert.ok(TIERS.d2e.ilvl * RARITY.epic.mult > world[3]);
  for (const i of Object.values(ITEMS)) if (['rare', 'epic', 'legendary'].includes(i.rarity)) assert.equal(i.source, 'dungeon');
});

test('overworld: every dungeon entrance and every spawn is reachable from town', () => {
  const w = genOverworld(), reach = floodFill(w, w.start.x, w.start.y);
  for (const d of Object.values(DUNGEONS)) assert.ok(reach[d.y * w.w + d.x], d.name);
  for (const s of w.spawns) assert.ok(reach[Math.floor(s.y) * w.w + Math.floor(s.x)]);
  for (const z of ZONES.slice(1)) assert.ok(w.spawns.filter((s) => s.zone === z.id).length > 20, z.id);
  let unreachable = 0;
  for (let k = 0; k < w.tiles.length; k++) if (isWalkable(w.tiles[k]) && !reach[k]) unreachable++;
  assert.equal(unreachable, 0);
});

test('dungeons: deterministic per seed, fully connected, boss reachable (seed sweep)', () => {
  const a = genDungeon('crypt', 42), b = genDungeon('crypt', 42);
  assert.deepEqual(a.tiles, b.tiles);
  assert.deepEqual(a.spawns, b.spawns);
  assert.notDeepEqual(a.tiles, genDungeon('crypt', 43).tiles);
  for (const id of Object.keys(DUNGEONS)) {
    for (let seed = 1; seed <= 60; seed++) {
      const d = genDungeon(id, seed), reach = floodFill(d, d.start.x, d.start.y);
      assert.equal(d.spawns.filter((s) => s.boss).length, 1);
      for (const s of d.spawns) assert.ok(reach[Math.floor(s.y) * d.w + Math.floor(s.x)], `${id}/${seed}`);
      assert.ok(d.spawns.length >= 10, `${id}/${seed} has too few enemies`);
    }
  }
  const d = genDungeon('mines', 9), path = findPath(d, d.start.x, d.start.y, d.boss.x, d.boss.y, 5000);
  assert.ok(path && path.length > 10);
});
