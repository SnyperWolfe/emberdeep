// Authoritative world simulation. Clients only send intent (move direction, "attack at this
// angle", "buy this"); every outcome is decided here.
import { makeRng } from '../shared/rng.js';
import { CLASSES, ENEMIES, DUNGEONS, ITEMS, NPCS, QUESTS, SHOP, WORLD, MAX_PARTY, tierItems } from '../shared/content.js';
import * as R from '../shared/rules.js';
import { genOverworld, genDungeon, zoneAt } from '../shared/mapgen.js';
import { moveWithCollision, lineOfSight, tileBlocked } from '../shared/collide.js';
import { findPath } from '../shared/path.js';

const VIEW_X = 20, VIEW_Y = 13;      // interest rectangle (tiles): what a client is told about
const RESPAWN_MOB = 25, RESPAWN_PLAYER = 4, POTION_CD = 6;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const r2 = (v) => Math.round(v * 100) / 100;

export class Game {
  constructor({ store, seed = Date.now() }) {
    this.store = store;
    this.rng = makeRng(seed);
    this.now = 0;
    this.tickN = 0;
    this.nextId = 1;
    this.players = new Map();   // lower-case name -> player
    this.dungeons = new Map();  // key -> instance
    this.nextParty = 1;
    this.world = this.makeInstance('world', genOverworld());
    for (const s of this.world.map.spawns) this.spawnMob(this.world, s);
    for (const n of NPCS) this.addEnt(this.world, { k: 'n', n: n.name, c: n.color, r: n.role, x: n.x, y: n.y });
    for (const [id, d] of Object.entries(DUNGEONS)) {
      this.addEnt(this.world, { k: 'o', n: d.name, dungeon: id, lv: d.minLevel, x: d.x + 0.5, y: d.y + 0.5 });
    }
  }

  // ---- instances & entities --------------------------------------------------------------
  makeInstance(kind, map, extra = {}) {
    return { kind, map, ents: new Map(), mobs: new Set(), players: new Set(), projs: new Set(), events: [], respawns: [], emptyAt: 0, ...extra };
  }

  addEnt(inst, e) {
    e.id = this.nextId++;
    e.inst = inst;
    inst.ents.set(e.id, e);
    return e;
  }

  spawnMob(inst, s, summoned = false) {
    const def = ENEMIES[s.mob], st = R.enemyStats(def, s.level);
    const m = this.addEnt(inst, {
      k: 'm', mob: s.mob, def, level: s.level, x: s.x, y: s.y, hx: s.x, hy: s.y, spawn: s, summoned,
      hp: st.maxHp, maxHp: st.maxHp, atk: st.attack, defense: st.defense, xp: summoned ? 0 : st.xp, gold: summoned ? 0 : st.gold,
      state: 'idle', target: 0, cdAt: 0, path: null, pathAt: 0, wanderAt: this.now + this.rng.range(0, 6), wx: s.x, wy: s.y,
      slowUntil: 0, slamAt: 0, casting: null, summonedAdds: false,
    });
    inst.mobs.add(m);
    return m;
  }

  emit(inst, ev) { inst.events.push(ev); }

  // ---- players ---------------------------------------------------------------------------
  addPlayer(acc, send) {
    const old = this.players.get(acc.name.toLowerCase());
    if (old) { old.send({ t: 'kick', msg: 'Logged in from another location.' }); this.removePlayer(old); old.onKick?.(); }
    const pos = acc.pos || this.world.map.start;
    const p = this.addEnt(this.world, {
      k: 'p', ch: acc, name: acc.name, send, x: pos.x, y: pos.y, dx: 0, dy: 0, facing: 0,
      cd: {}, lastHit: -99, dead: false, respawnAt: 0, party: null, invite: null, zone: '', hpAcc: 0,
    });
    this.world.players.add(p);
    p.stats = R.derive(acc);
    p.hp = p.stats.maxHp; p.mp = p.stats.maxMp;
    this.players.set(acc.name.toLowerCase(), p);
    this.sendMap(p);
    this.sendYou(p);
    this.sys(p, `Welcome to Emberhold, ${p.name}. Captain Mara has work for you.`);
    this.broadcast({ t: 'chat', ch: 'sys', text: `${p.name} has entered the world.` }, p);
    return p;
  }

  removePlayer(p) {
    if (!this.players.has(p.name.toLowerCase()) || this.players.get(p.name.toLowerCase()) !== p) return;
    this.leaveParty(p);
    this.persist(p);
    this.detach(p);
    this.players.delete(p.name.toLowerCase());
    this.broadcast({ t: 'chat', ch: 'sys', text: `${p.name} has left the world.` });
  }

  persist(p) {
    if (p.inst.kind === 'world') p.ch.pos = { x: r2(p.x), y: r2(p.y) };
    try { this.store.save(p.ch); } catch (err) { console.error(`save failed for ${p.name}:`, err.message); this.sys(p, 'Warning: your progress could not be saved.'); }
  }

  saveAll() { for (const p of this.players.values()) this.persist(p); }

  detach(p) {
    const inst = p.inst;
    inst.ents.delete(p.id);
    inst.players.delete(p);
    if (inst.kind === 'dungeon' && inst.players.size === 0) inst.emptyAt = this.now;
  }

  transfer(p, inst, x, y) {
    this.detach(p);
    p.inst = inst; p.x = x; p.y = y; p.dx = p.dy = 0;
    inst.ents.set(p.id, p);
    inst.players.add(p);
    this.sendMap(p);
  }

  sendMap(p) {
    const { map, kind, dungeonId } = p.inst;
    p.send({ t: 'map', kind, dungeon: dungeonId || null, name: kind === 'dungeon' ? DUNGEONS[dungeonId].name : 'Emberdeep', w: map.w, h: map.h, tiles: Buffer.from(map.tiles).toString('base64'), x: p.x, y: p.y });
  }

  sendYou(p) {
    const ch = p.ch;
    p.send({ t: 'you', id: p.id, name: ch.name, cls: ch.cls, level: ch.level, xp: ch.xp, xpNext: R.xpToNext(ch.level), gold: ch.gold, inv: ch.inv, equip: ch.equip, quests: ch.quests, stats: p.stats });
  }

  /** Call after anything that changes the character sheet. */
  refresh(p) {
    p.stats = R.derive(p.ch);
    p.hp = Math.min(p.hp, p.stats.maxHp);
    p.mp = Math.min(p.mp, p.stats.maxMp);
    this.sendYou(p);
  }

  sys(p, text) { p.send({ t: 'chat', ch: 'sys', text }); }
  broadcast(msg, except) { for (const p of this.players.values()) if (p !== except) p.send(msg); }

  // ---- input handlers (all validated; never trust the client) ----------------------------
  setMove(p, dx, dy) {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }
    p.dx = dx; p.dy = dy;
  }

  attack(p, angle) { this.useAbility(p, CLASSES[p.ch.cls].attack, 'a', angle); }

  skill(p, i, angle) {
    const ab = CLASSES[p.ch.cls].skills[i];
    if (ab) this.useAbility(p, ab, 's' + i, angle);
  }

  useAbility(p, ab, key, angle) {
    if (p.dead || !Number.isFinite(angle) || this.now < (p.cd[key] || 0)) return;
    if (ab.lvl && p.ch.level < ab.lvl) return this.sys(p, `${ab.name} unlocks at level ${ab.lvl}.`);
    if (ab.mp && p.mp < ab.mp) return p.send({ t: 'note', text: 'Not enough mana.' });
    p.cd[key] = this.now + ab.cd;
    p.mp -= ab.mp || 0;
    p.facing = angle;
    if (key !== 'a') p.send({ t: 'cd', k: key, d: ab.cd });
    const inst = p.inst;
    if (ab.type === 'melee') {
      this.emit(inst, { t: 'swing', id: p.id, x: p.x, y: p.y, a: r2(angle), r: ab.range, arc: ab.arc });
      for (const m of [...inst.mobs]) {
        const d = dist(p, m);
        if (d > ab.range + m.def.size * 0.35) continue;
        let diff = Math.abs(Math.atan2(m.y - p.y, m.x - p.x) - angle) % (Math.PI * 2);
        if (diff > Math.PI) diff = Math.PI * 2 - diff;
        if (d < 0.6 || diff <= ab.arc / 2) this.hitMob(inst, p, m, ab.mult);
      }
    } else if (ab.type === 'aoe') {
      this.emit(inst, { t: 'nova', x: p.x, y: p.y, r: ab.r, c: ab.slow ? 0x9fe0ff : 0xffe0a0 });
      for (const m of [...inst.mobs]) {
        if (dist(p, m) > ab.r + m.def.size * 0.35) continue;
        if (ab.slow) m.slowUntil = this.now + ab.slow;
        this.hitMob(inst, p, m, ab.mult);
      }
    } else if (ab.type === 'proj') {
      const n = ab.count || 1;
      for (let i = 0; i < n; i++) {
        const a = angle + (n > 1 ? (i / (n - 1) - 0.5) * ab.spread : 0);
        this.spawnProj(inst, { x: p.x, y: p.y, a, speed: ab.speed, range: ab.range, team: 'p', owner: p, atk: p.stats.attack, mult: ab.mult, pierce: ab.pierce, aoe: ab.aoe, c: ab.color });
      }
    } else if (ab.type === 'heal') {
      const v = Math.round(p.stats.maxHp * ab.pct);
      p.hp = Math.min(p.stats.maxHp, p.hp + v);
      this.emit(inst, { t: 'heal', id: p.id, x: p.x, y: p.y, v });
    }
  }

  usePotion(p, kind) {
    const id = kind === 'mp' ? 'mp_potion' : 'hp_potion', item = ITEMS[id], slot = R.findItem(p.ch, id);
    if (p.dead || this.now < (p.cd.pot || 0)) return;
    if (slot < 0) return p.send({ t: 'note', text: `No ${item.name}s left.` });
    R.removeAt(p.ch, slot, 1);
    p.cd.pot = this.now + POTION_CD;
    if (item.heal) { const v = Math.round(p.stats.maxHp * item.heal); p.hp = Math.min(p.stats.maxHp, p.hp + v); this.emit(p.inst, { t: 'heal', id: p.id, x: p.x, y: p.y, v }); }
    if (item.mana) p.mp = Math.min(p.stats.maxMp, p.mp + p.stats.maxMp * item.mana);
    p.send({ t: 'cd', k: 'pot', d: POTION_CD });
    this.sendYou(p);
  }

  equip(p, slot) { this.sheetOp(p, R.equip(p.ch, slot | 0)); }
  unequip(p, slotName) { if (slotName in p.ch.equip) this.sheetOp(p, R.unequip(p.ch, slotName)); }
  sheetOp(p, err) { if (err) p.send({ t: 'note', text: err }); else this.refresh(p); }

  nearNpc(p, role) {
    if (p.inst !== this.world || p.dead) return false;
    return NPCS.some((n) => n.role === role && Math.hypot(n.x - p.x, n.y - p.y) < 4);
  }

  buy(p, id) {
    const item = ITEMS[id];
    if (!this.nearNpc(p, 'shop') || !item || !SHOP.includes(id)) return;
    if (p.ch.gold < item.value) return p.send({ t: 'note', text: 'Not enough gold.' });
    if (R.addItem(p.ch, id, 1) > 0) return p.send({ t: 'note', text: 'Inventory is full.' });
    p.ch.gold -= item.value;
    this.sendYou(p);
  }

  sell(p, slot, all) {
    const s = p.ch.inv[slot | 0], item = s && ITEMS[s.id];
    if (!this.nearNpc(p, 'shop') || !item) return;
    const n = all ? s.n : 1;
    R.removeAt(p.ch, slot | 0, n);
    p.ch.gold += Math.max(1, Math.floor(item.value * 0.3)) * n;
    this.sendYou(p);
  }

  quest(p, op, id) {
    if (!this.nearNpc(p, 'quests')) return;
    if (op === 'accept') {
      const q = QUESTS.find((x) => x.id === id);
      if (q && p.ch.level < q.level - 1) return p.send({ t: 'note', text: `Come back at level ${q.level - 1}.` });
      return this.sheetOp(p, R.acceptQuest(p.ch, id));
    }
    if (op !== 'turnin') return;
    const res = R.turnInQuest(p.ch, id);
    if (res.error) return p.send({ t: 'note', text: res.error });
    this.sys(p, `Quest complete: ${res.quest.name} (+${res.quest.rewards.xp} XP, +${res.quest.rewards.gold} gold)`);
    this.afterXp(p, res.levels);
    this.refresh(p);
    this.persist(p); // quest turn-in is a safe boundary: autosave
  }

  interact(p) {
    if (p.dead) return;
    let best = null;
    for (const e of p.inst.ents.values()) {
      if ((e.k === 'n' || e.k === 'o') && dist(p, e) < 2.2 && (!best || dist(p, e) < dist(p, best))) best = e;
    }
    if (!best) return;
    if (best.k === 'n') return p.send({ t: 'open', ui: best.r });
    if (best.exit) return this.leaveDungeon(p);
    this.enterDungeon(p, best.dungeon);
  }

  enterDungeon(p, id) {
    const def = DUNGEONS[id];
    if (p.ch.level < def.minLevel) {
      return this.sys(p, `${def.name} requires level ${def.minLevel}. Level up in the open world first.`);
    }
    const key = `${p.party ? 'party' + p.party.id : p.name.toLowerCase()}:${id}`;
    let inst = this.dungeons.get(key);
    if (!inst) {
      const map = genDungeon(id, this.rng.int(1, 2 ** 31 - 1));
      inst = this.makeInstance('dungeon', map, { dungeonId: id, key });
      for (const s of map.spawns) this.spawnMob(inst, s);
      this.addEnt(inst, { k: 'o', n: 'Leave dungeon', exit: true, x: map.start.x, y: map.start.y - 1 });
      this.dungeons.set(key, inst);
    }
    p.ch.pos = { x: def.x + 0.5, y: def.y + 2.5 };
    this.transfer(p, inst, inst.map.start.x, inst.map.start.y);
    this.sys(p, `You enter ${def.name}. Enemies here are level ${def.lv}+ elites.`);
  }

  leaveDungeon(p) {
    const def = DUNGEONS[p.inst.dungeonId];
    this.transfer(p, this.world, def.x + 0.5, def.y + 2.5);
  }

  chat(p, text) {
    text = String(text).replace(/[\u0000-\u001f]/g, '').trim().slice(0, 200);
    if (!text) return;
    if (text[0] !== '/') return this.broadcast({ t: 'chat', ch: 'say', from: p.name, text });
    const [cmd, ...rest] = text.slice(1).split(' '), arg = rest.join(' ').trim();
    if (cmd === 'invite') return this.invite(p, arg);
    if (cmd === 'accept') return this.acceptInvite(p);
    if (cmd === 'leave') return this.leaveParty(p, true);
    if (cmd === 'p' && p.party) { for (const m of p.party.members) m.send({ t: 'chat', ch: 'party', from: p.name, text: arg }); return; }
    if (cmd === 'who') return this.sys(p, `Online (${this.players.size}): ${[...this.players.values()].map((o) => `${o.name} (${o.ch.level})`).join(', ')}`);
    this.sys(p, 'Commands: /invite <name>, /accept, /leave, /p <message>, /who');
  }

  // ---- parties ---------------------------------------------------------------------------
  invite(p, name) {
    const t = this.players.get(String(name).toLowerCase());
    if (!t || t === p) return this.sys(p, 'No such player online.');
    if (t.party) return this.sys(p, `${t.name} is already in a party.`);
    if (p.party && p.party.members.size >= MAX_PARTY) return this.sys(p, 'Your party is full.');
    t.invite = { from: p, at: this.now };
    t.send({ t: 'invite', from: p.name });
    this.sys(p, `Invited ${t.name} to your party.`);
  }

  acceptInvite(p) {
    const inv = p.invite, from = inv?.from;
    p.invite = null;
    if (!inv || this.now - inv.at > 60 || this.players.get(from.name.toLowerCase()) !== from) return this.sys(p, 'No pending invite.');
    if (p.party) return this.sys(p, 'Leave your current party first.');
    if (!from.party) from.party = { id: this.nextParty++, members: new Set([from]) };
    if (from.party.members.size >= MAX_PARTY) return this.sys(p, 'That party is full.');
    from.party.members.add(p);
    p.party = from.party;
    for (const m of p.party.members) this.sys(m, `${p.name} joined the party.`);
  }

  leaveParty(p, announce) {
    const party = p.party;
    if (!party) { if (announce) this.sys(p, 'You are not in a party.'); return; }
    party.members.delete(p);
    p.party = null;
    if (announce) this.sys(p, 'You left the party.');
    for (const m of party.members) this.sys(m, `${p.name} left the party.`);
    if (party.members.size === 1) { const [last] = party.members; last.party = null; }
  }

  // ---- combat ----------------------------------------------------------------------------
  spawnProj(inst, o) {
    const j = this.addEnt(inst, { k: 'j', x: o.x, y: o.y, vx: Math.cos(o.a) * o.speed, vy: Math.sin(o.a) * o.speed, a: r2(o.a), left: o.range, hit: new Set(), ...o });
    inst.projs.add(j);
  }

  removeProj(inst, j) { inst.projs.delete(j); inst.ents.delete(j.id); }

  hitMob(inst, p, m, mult) {
    if (!inst.mobs.has(m)) return;
    const { dmg, crit } = R.rollDamage(this.rng, p.stats.attack, mult, m.defense, p.stats.crit);
    m.hp -= dmg;
    this.emit(inst, { t: 'dmg', id: m.id, x: r2(m.x), y: r2(m.y), v: dmg, crit });
    if (m.state !== 'chase' && !p.dead) { m.state = 'chase'; m.target = p.id; }
    if (m.def.summon && !m.summonedAdds && m.hp < m.maxHp * 0.5 && m.hp > 0) {
      m.summonedAdds = true;
      for (let i = 0; i < 2; i++) {
        const a = i * Math.PI, add = this.spawnMob(inst, { mob: m.def.summon, level: m.level - 2, x: m.x, y: m.y }, true);
        moveWithCollision(inst.map, add, Math.cos(a) * 1.5, Math.sin(a) * 1.5);
        add.state = 'chase'; add.target = p.id;
      }
      this.emit(inst, { t: 'shout', x: m.x, y: m.y, text: `${m.def.name} calls for aid!` });
    }
    if (m.hp <= 0) this.killMob(inst, m, p);
  }

  hitPlayer(inst, p, atk, mult) {
    if (p.dead) return;
    const { dmg } = R.rollDamage(this.rng, atk, mult, p.stats.defense, 0);
    p.hp -= dmg;
    p.lastHit = this.now;
    this.emit(inst, { t: 'dmg', id: p.id, x: r2(p.x), y: r2(p.y), v: dmg, pl: 1 });
    if (p.hp > 0) return;
    p.hp = 0; p.dead = true; p.dx = p.dy = 0;
    p.respawnAt = this.now + RESPAWN_PLAYER;
    this.emit(inst, { t: 'die', id: p.id, x: p.x, y: p.y, pl: 1 });
    this.sys(p, inst.kind === 'dungeon' ? 'You died. Returning to the dungeon entrance...' : 'You died. Returning to Emberhold...');
  }

  killMob(inst, m, killer) {
    inst.mobs.delete(m);
    inst.ents.delete(m.id);
    this.emit(inst, { t: 'die', id: m.id, x: r2(m.x), y: r2(m.y), c: m.def.color, boss: m.def.boss ? 1 : 0 });
    if (inst.kind === 'world' && !m.summoned) inst.respawns.push({ at: this.now + RESPAWN_MOB, spawn: m.spawn });
    const group = killer.party ? [...killer.party.members].filter((o) => o.inst === inst && dist(o, m) < 30) : [killer];
    if (!group.includes(killer)) group.push(killer);
    const share = (1 + 0.25 * (group.length - 1)) / group.length; // parties earn a bonus overall
    for (const p of group) {
      p.ch.gold += Math.ceil(m.gold * share);
      const levels = R.gainXp(p.ch, m.xp * share * R.xpScale(p.ch.level, m.level));
      const quests = R.onKill(p.ch, m.mob);
      for (const q of quests) if (p.ch.quests[q.id].state === 'complete') this.sys(p, `Objective complete: ${q.name}. Return to Captain Mara.`);
      if (!m.summoned) this.rollLoot(p, m, inst);
      this.afterXp(p, levels);
      this.sendYou(p);
    }
    if (m.def.boss) {
      inst.cleared = true;
      this.addEnt(inst, { k: 'o', n: 'Leave dungeon', exit: true, x: m.hx, y: m.hy });
      this.broadcast({ t: 'chat', ch: 'sys', text: `${group.map((p) => p.name).join(', ')} defeated ${m.def.name} in ${DUNGEONS[inst.dungeonId].name}!` });
      for (const p of group) this.persist(p);
    }
  }

  afterXp(p, levels) {
    if (!levels) return;
    p.stats = R.derive(p.ch);
    p.hp = p.stats.maxHp; p.mp = p.stats.maxMp;
    this.emit(p.inst, { t: 'levelup', id: p.id, x: p.x, y: p.y, l: p.ch.level });
    const unlocked = CLASSES[p.ch.cls].skills.filter((s) => s.lvl > p.ch.level - levels && s.lvl <= p.ch.level);
    const next = CLASSES[p.ch.cls].skills.find((s) => s.lvl > p.ch.level);
    const dungeon = Object.values(DUNGEONS).find((d) => d.minLevel > p.ch.level - levels && d.minLevel <= p.ch.level);
    this.sys(p, `Level ${p.ch.level}!` + unlocked.map((s) => ` New skill: ${s.name}.`).join('') + (dungeon ? ` You can now enter ${dungeon.name}.` : '') + (next ? ` Next skill at level ${next.lvl}.` : ''));
    this.persist(p);
  }

  give(p, id, n = 1) {
    const item = ITEMS[id], left = R.addItem(p.ch, id, n);
    if (left < n) p.send({ t: 'loot', id, n: n - left });
    if (left > 0) {
      const gold = Math.max(1, Math.floor(item.value * 0.3)) * left;
      p.ch.gold += gold;
      this.sys(p, `Inventory full: ${item.name} was sold for ${gold} gold.`);
    }
  }

  /** Personal loot. The open world tops out at uncommon; rare and better only drop in dungeons. */
  rollLoot(p, m, inst) {
    const rng = this.rng, cls = p.ch.cls;
    if (m.def.boss) {
      const d = DUNGEONS[inst.dungeonId];
      this.give(p, rng.pick(tierItems(d.epic, cls)));
      if (rng.chance(0.5)) this.give(p, rng.pick(tierItems(d.rare, cls)));
      this.give(p, 'hp_potion', 3);
      if (d.legendary) { // pity counter: the chance grows with every kill that drops none
        if (rng.chance(0.2 + 0.15 * p.ch.pity)) { p.ch.pity = 0; this.give(p, rng.pick(tierItems(d.legendary, cls))); }
        else p.ch.pity++;
      }
      return;
    }
    if (rng.chance(0.1)) this.give(p, 'hp_potion');
    if (rng.chance(0.05)) this.give(p, 'mp_potion');
    if (inst.kind === 'dungeon') {
      if (rng.chance(0.12)) this.give(p, rng.pick(tierItems(DUNGEONS[inst.dungeonId].rare, cls)));
    } else if (rng.chance(0.06)) {
      this.give(p, rng.pick(tierItems(zoneAt(m.hx, m.hy).zone.gear, cls)));
    }
  }

  // ---- simulation ------------------------------------------------------------------------
  tick(dt) {
    this.now += dt;
    this.tickN++;
    this.updateInstance(this.world, dt);
    for (const [key, inst] of this.dungeons) {
      if (inst.players.size === 0) {
        if (inst.cleared || this.now - inst.emptyAt > 120) this.dungeons.delete(key);
        continue;
      }
      this.updateInstance(inst, dt);
    }
    if (this.tickN % 2 === 0) this.snapshots();
  }

  inTown(p) { return p.inst === this.world && Math.hypot(p.x - WORLD.cx, p.y - WORLD.cy) < 9; }

  updateInstance(inst, dt) {
    const now = this.now;
    for (const p of inst.players) {
      if (p.dead) {
        if (now >= p.respawnAt) {
          p.dead = false; p.hp = p.stats.maxHp; p.mp = p.stats.maxMp;
          p.x = inst.map.start.x; p.y = inst.map.start.y;
          p.send({ t: 'respawn', x: p.x, y: p.y });
        }
        continue;
      }
      if (p.dx || p.dy) moveWithCollision(inst.map, p, p.dx * p.stats.speed * dt, p.dy * p.stats.speed * dt);
      p.mp = Math.min(p.stats.maxMp, p.mp + (1 + p.stats.maxMp * 0.02) * dt);
      const safe = this.inTown(p);
      if (safe || now - p.lastHit > 6) p.hp = Math.min(p.stats.maxHp, p.hp + p.stats.maxHp * (safe ? 0.12 : 0.03) * dt);
      if ((this.tickN + p.id) % 10 === 0) p.zone = inst.kind === 'world' ? zoneAt(p.x, p.y).zone.name : DUNGEONS[inst.dungeonId].name;
    }
    if (inst.players.size === 0) return;
    for (const m of inst.mobs) this.updateMob(inst, m, dt);
    for (const j of inst.projs) this.updateProj(inst, j, dt);
    for (let i = inst.respawns.length - 1; i >= 0; i--) {
      if (now >= inst.respawns[i].at) { this.spawnMob(inst, inst.respawns[i].spawn); inst.respawns.splice(i, 1); }
    }
  }

  steer(inst, m, tx, ty, speed, dt) {
    if (this.now < m.slowUntil) speed *= 0.5;
    let gx = tx, gy = ty;
    if (!lineOfSight(inst.map, m.x, m.y, tx, ty)) {
      // Decide -> path -> steer: re-plan on a timer, follow waypoints in between.
      if (!m.path || this.now >= m.pathAt) { m.path = findPath(inst.map, m.x, m.y, tx, ty); m.pathAt = this.now + 0.6; }
      while (m.path?.length && Math.hypot(m.path[0].x - m.x, m.path[0].y - m.y) < 0.35) m.path.shift();
      if (!m.path?.length) return;
      gx = m.path[0].x; gy = m.path[0].y;
    } else m.path = null;
    const d = Math.hypot(gx - m.x, gy - m.y);
    if (d < 0.05) return;
    const step = Math.min(d, speed * dt);
    moveWithCollision(inst.map, m, ((gx - m.x) / d) * step, ((gy - m.y) / d) * step);
  }

  updateMob(inst, m, dt) {
    const now = this.now, def = m.def, dungeon = inst.kind === 'dungeon';
    if (m.casting) { // boss slam: telegraphed, then resolves where it was aimed
      if (now < m.casting.at) return;
      for (const p of inst.players) if (dist(p, m.casting) <= m.casting.r) this.hitPlayer(inst, p, m.atk, def.slam.mult);
      this.emit(inst, { t: 'slam', x: m.casting.x, y: m.casting.y, r: m.casting.r });
      m.casting = null;
      return;
    }
    if (m.state === 'idle') {
      if ((this.tickN + m.id) % 4 === 0) {
        let best = null, bd = def.aggro;
        for (const p of inst.players) {
          const d = dist(p, m);
          if (p.dead || d >= bd || this.inTown(p)) continue;
          if (dungeon && !lineOfSight(inst.map, m.x, m.y, p.x, p.y)) continue;
          best = p; bd = d;
        }
        if (best) { m.state = 'chase'; m.target = best.id; m.cdAt = now + 0.5; return; } // brief wind-up before the first hit
      }
      if (now >= m.wanderAt) {
        m.wanderAt = now + this.rng.range(3, 9);
        m.wx = m.hx + this.rng.range(-2.5, 2.5); m.wy = m.hy + this.rng.range(-2.5, 2.5);
      }
      const d = Math.hypot(m.wx - m.x, m.wy - m.y);
      if (d > 0.2) moveWithCollision(inst.map, m, ((m.wx - m.x) / d) * def.spd * 0.35 * dt, ((m.wy - m.y) / d) * def.spd * 0.35 * dt);
      return;
    }
    if (m.state === 'return') {
      m.hp = Math.min(m.maxHp, m.hp + m.maxHp * 0.4 * dt);
      if (Math.hypot(m.hx - m.x, m.hy - m.y) < 0.6) { m.state = 'idle'; m.hp = m.maxHp; m.path = null; return; }
      return this.steer(inst, m, m.hx, m.hy, def.spd * 1.6, dt);
    }
    // chase
    const t = inst.ents.get(m.target);
    const leash = dungeon ? 60 : 16;
    if (!t || t.dead || t.k !== 'p' || this.inTown(t) || Math.hypot(m.hx - m.x, m.hy - m.y) > leash) {
      // Try another nearby player before giving up (keeps bosses on the party).
      let alt = null;
      for (const p of inst.players) if (!p.dead && !this.inTown(p) && dist(p, m) < def.aggro + 4 && Math.hypot(m.hx - m.x, m.hy - m.y) <= leash) alt = p;
      if (alt) m.target = alt.id; else { m.state = 'return'; m.path = null; }
      return;
    }
    const d = dist(m, t), ranged = def.range > 2;
    if (def.slam && now >= m.slamAt && d < def.slam.r + 0.5) {
      m.slamAt = now + def.slam.cd;
      m.casting = { at: now + def.slam.windup, x: m.x, y: m.y, r: def.slam.r };
      this.emit(inst, { t: 'tele', x: r2(m.x), y: r2(m.y), r: def.slam.r, d: def.slam.windup });
      return;
    }
    const inRange = d <= def.range + (ranged ? 0 : def.size * 0.35) && (!ranged || lineOfSight(inst.map, m.x, m.y, t.x, t.y));
    if (!inRange) return this.steer(inst, m, t.x, t.y, def.spd, dt);
    if (now < m.cdAt) return;
    m.cdAt = now + def.cd;
    const a = Math.atan2(t.y - m.y, t.x - m.x);
    this.emit(inst, { t: 'matk', id: m.id, x: r2(m.x), y: r2(m.y), a: r2(a) });
    if (ranged) this.spawnProj(inst, { x: m.x, y: m.y, a, speed: 9, range: def.range + 3, team: 'm', atk: m.atk, mult: 1, c: def.proj });
    else this.hitPlayer(inst, t, m.atk, 1);
  }

  updateProj(inst, j, dt) {
    for (let s = 0; s < 2; s++) {
      j.x += j.vx * dt * 0.5; j.y += j.vy * dt * 0.5;
      j.left -= Math.hypot(j.vx, j.vy) * dt * 0.5;
      let end = j.left <= 0 || tileBlocked(inst.map, Math.floor(j.x), Math.floor(j.y));
      if (!end && j.team === 'p') {
        for (const m of inst.mobs) {
          if (j.hit.has(m.id) || dist(j, m) > 0.4 + m.def.size * 0.35) continue;
          if (j.aoe) { end = true; break; }
          j.hit.add(m.id);
          this.hitMob(inst, j.owner, m, j.mult);
          if (!j.pierce) { this.removeProj(inst, j); return; }
        }
      } else if (!end) {
        for (const p of inst.players) {
          if (p.dead || dist(j, p) > 0.5) continue;
          this.hitPlayer(inst, p, j.atk, j.mult);
          this.removeProj(inst, j);
          return;
        }
      }
      if (end) {
        if (j.aoe) {
          this.emit(inst, { t: 'nova', x: r2(j.x), y: r2(j.y), r: j.aoe, c: j.c });
          for (const m of [...inst.mobs]) if (dist(j, m) <= j.aoe + m.def.size * 0.35) this.hitMob(inst, j.owner, m, j.mult);
        }
        this.removeProj(inst, j);
        return;
      }
    }
  }

  // ---- replication: each client only receives what is near it ------------------------------
  view(e) {
    const base = { id: e.id, k: e.k, x: r2(e.x), y: r2(e.y) };
    if (e.k === 'm') return { ...base, s: e.def.shape, c: e.def.color, n: e.def.name, l: e.level, hp: Math.max(0, Math.round(e.hp)), mh: e.maxHp, z: e.def.size, b: e.def.boss ? 1 : 0, el: e.def.elite ? 1 : 0, cast: e.casting ? 1 : 0 };
    if (e.k === 'p') return { ...base, n: e.name, l: e.ch.level, c: e.ch.cls, hp: Math.round(e.hp), mh: e.stats.maxHp, d: e.dead ? 1 : 0, f: r2(e.facing) };
    if (e.k === 'j') return { ...base, c: e.c, a: e.a, vx: r2(e.vx), vy: r2(e.vy) };
    if (e.k === 'o') return { ...base, n: e.n, lv: e.lv || 0, ex: e.exit ? 1 : 0 };
    return { ...base, n: e.n, c: e.c, r: e.r };
  }

  snapshots() {
    const insts = [this.world, ...this.dungeons.values()];
    for (const inst of insts) {
      if (inst.players.size === 0) { inst.events.length = 0; continue; }
      const views = new Map();
      for (const p of inst.players) {
        const ents = [];
        for (const e of inst.ents.values()) {
          if (e === p || Math.abs(e.x - p.x) > VIEW_X || Math.abs(e.y - p.y) > VIEW_Y) continue;
          let v = views.get(e.id);
          if (!v) views.set(e.id, (v = this.view(e)));
          ents.push(v);
        }
        const ev = inst.events.filter((e) => Math.abs(e.x - p.x) <= VIEW_X && Math.abs(e.y - p.y) <= VIEW_Y);
        const pt = p.party ? [...p.party.members].filter((m) => m !== p).map((m) => ({ n: m.name, l: m.ch.level, c: m.ch.cls, hp: Math.round(m.hp), mh: m.stats.maxHp, here: m.inst === inst ? 1 : 0, x: r2(m.x), y: r2(m.y) })) : [];
        p.send({ t: 's', x: r2(p.x), y: r2(p.y), hp: Math.round(p.hp), mp: Math.round(p.mp), d: p.dead ? 1 : 0, z: p.zone, e: ents, ev, pt });
      }
      inst.events.length = 0;
    }
  }
}
