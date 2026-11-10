// Pure game rules shared by the server and the tests: stats, damage, XP, inventory, quests.
import { CLASSES, ITEMS, QUESTS, SLOTS, INV_SIZE, MAX_LEVEL } from './content.js';

export const SAVE_VERSION = 2;

export function newCharacter(name, cls) {
  const ch = {
    version: SAVE_VERSION, name, cls, level: 1, xp: 0, gold: 20,
    inv: new Array(INV_SIZE).fill(null),
    equip: { weapon: `c1_weapon_${cls}`, helm: null, chest: 'c1_chest', boots: null, ring: null },
    quests: {}, pos: null, pity: 0, created: Date.now(),
  };
  addItem(ch, 'hp_potion', 3);
  return ch;
}

// ---- Stats -------------------------------------------------------------------------------
// Level + class are the only truth for attributes; everything else is derived on demand.
export function baseStats(cls, level) {
  const c = CLASSES[cls], out = {};
  for (const k of Object.keys(c.base)) out[k] = c.base[k] + c.growth[k] * (level - 1);
  return out;
}

/** Modifier layers: base -> flat adds -> summed percents -> clamp. Gear is never baked in. */
export function derive(ch) {
  const s = baseStats(ch.cls, ch.level);
  const flat = {}, pct = {};
  for (const slot of SLOTS) {
    const item = ITEMS[ch.equip[slot]];
    if (!item) continue;
    for (const m of item.mods) {
      const bucket = m.type === 'pct' ? pct : flat;
      bucket[m.stat] = (bucket[m.stat] || 0) + m.value;
    }
  }
  for (const k of Object.keys(s)) s[k] += flat[k] || 0;
  const fin = (k, v) => (v + (flat[k] || 0)) * (1 + (pct[k] || 0));
  return {
    ...s,
    maxHp: Math.round(fin('HP', 40 + s.VIT * 10 + ch.level * 5)),
    maxMp: Math.round(fin('MP', 20 + s.INT * 4 + ch.level * 2)),
    attack: Math.round(fin('ATK', s[CLASSES[ch.cls].primary] * 2)),
    defense: Math.round(fin('DEF', s.VIT * 0.5 + s.AGI * 0.25)),
    crit: Math.min(fin('CRIT', 0.05 + s.AGI * 0.004), 0.5),
    speed: Math.min(fin('SPD', 4.6), 7),
  };
}

// ---- Combat ------------------------------------------------------------------------------
const K = 60; // defense == K halves incoming damage (ratio mitigation scales smoothly)
export function rollDamage(rng, attack, mult, defense, critChance = 0) {
  let dmg = attack * mult * (K / (Math.max(0, defense) + K));
  dmg *= rng.range(0.9, 1.1);
  const crit = rng.chance(critChance);
  if (crit) dmg *= 1.5;
  return { dmg: Math.max(1, Math.round(dmg)), crit }; // round once, at the end
}

export function enemyStats(def, level) {
  return {
    maxHp: Math.round((30 + 18 * level) * def.hp),
    attack: (6 + 4 * level) * def.atk,
    defense: 2 + 1.5 * level,
    xp: Math.round((10 + 8 * level) * (def.boss ? 12 : def.elite ? 2 : 1)),
    gold: Math.round((1 + level) * (def.boss ? 25 : def.elite ? 2 : 1)),
  };
}

// ---- XP ----------------------------------------------------------------------------------
export const xpToNext = (level) => 50 * level * level + 50 * level;

/** Killing enemies far below your level is worth little, so players move outward. */
export function xpScale(playerLevel, mobLevel) {
  const diff = playerLevel - mobLevel;
  return diff >= 6 ? 0.1 : diff >= 4 ? 0.4 : 1;
}

/** Adds XP, returns the number of levels gained. */
export function gainXp(ch, amount) {
  if (ch.level >= MAX_LEVEL) { ch.xp = 0; return 0; }
  ch.xp += Math.max(0, Math.round(amount));
  let gained = 0;
  while (ch.level < MAX_LEVEL && ch.xp >= xpToNext(ch.level)) {
    ch.xp -= xpToNext(ch.level);
    ch.level++;
    gained++;
  }
  if (ch.level >= MAX_LEVEL) ch.xp = 0;
  return gained;
}

// ---- Inventory ---------------------------------------------------------------------------
/** Adds n of an item, stacking where allowed. Returns how many did NOT fit. */
export function addItem(ch, id, n = 1) {
  const item = ITEMS[id];
  if (!item) return n;
  const max = item.stack || 1;
  if (max > 1) {
    for (const s of ch.inv) {
      if (n > 0 && s && s.id === id && s.n < max) { const k = Math.min(n, max - s.n); s.n += k; n -= k; }
    }
  }
  for (let i = 0; i < ch.inv.length && n > 0; i++) {
    if (!ch.inv[i]) { const k = Math.min(n, max); ch.inv[i] = { id, n: k }; n -= k; }
  }
  return n;
}

export function removeAt(ch, slot, n = 1) {
  const s = ch.inv[slot];
  if (!s || s.n < n) return false;
  s.n -= n;
  if (s.n === 0) ch.inv[slot] = null;
  return true;
}

export const findItem = (ch, id) => ch.inv.findIndex((s) => s && s.id === id);
export const freeSlots = (ch) => ch.inv.filter((s) => !s).length;

/** Equip the gear in an inventory slot, swapping with what is worn. Returns an error or null. */
export function equip(ch, slot) {
  const s = ch.inv[slot], item = s && ITEMS[s.id];
  if (!item || item.kind !== 'gear') return 'That cannot be equipped.';
  if (item.cls && item.cls !== ch.cls) return `Only a ${CLASSES[item.cls].name} can use that.`;
  if (ch.level < item.req) return `Requires level ${item.req}.`;
  const prev = ch.equip[item.slot];
  ch.equip[item.slot] = item.id;
  ch.inv[slot] = prev ? { id: prev, n: 1 } : null;
  return null;
}

export function unequip(ch, slotName) {
  const id = ch.equip[slotName];
  if (!id) return 'Nothing equipped there.';
  if (freeSlots(ch) === 0) return 'Inventory is full.';
  ch.equip[slotName] = null;
  addItem(ch, id, 1);
  return null;
}

// ---- Quests ------------------------------------------------------------------------------
const questDef = (id) => QUESTS.find((q) => q.id === id);

export function questStatus(ch, q) {
  const st = ch.quests[q.id];
  if (st) return st.state;
  if (q.requires && ch.quests[q.requires]?.state !== 'turned_in') return 'locked';
  return 'available';
}

export function acceptQuest(ch, id) {
  const q = questDef(id);
  if (!q || questStatus(ch, q) !== 'available') return 'That quest is not available.';
  ch.quests[id] = { state: 'active', counts: q.objectives.map(() => 0) };
  return null;
}

/** Advance kill objectives. Returns the quests that changed. */
export function onKill(ch, enemyId) {
  const changed = [];
  for (const q of QUESTS) {
    const st = ch.quests[q.id];
    if (!st || st.state !== 'active') continue;
    let hit = false;
    q.objectives.forEach((o, i) => {
      if (o.target === enemyId && st.counts[i] < o.needed) { st.counts[i]++; hit = true; }
    });
    if (!hit) continue;
    if (q.objectives.every((o, i) => st.counts[i] >= o.needed)) st.state = 'complete';
    changed.push(q);
  }
  return changed;
}

/** Turn in a completed quest; rewards are granted exactly once. Returns {error} or {levels}. */
export function turnInQuest(ch, id) {
  const q = questDef(id), st = ch.quests[id];
  if (!q || !st || st.state !== 'complete') return { error: 'That quest is not complete.' };
  const items = q.rewards.items || [];
  if (freeSlots(ch) < items.length) return { error: 'Make room in your inventory first.' };
  st.state = 'turned_in';
  for (const [iid, n] of items) addItem(ch, iid, n);
  ch.gold += q.rewards.gold || 0;
  return { levels: gainXp(ch, q.rewards.xp || 0), quest: q };
}
