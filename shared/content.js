// All game content is data: tiles, classes, enemies, zones, dungeons, items, quests, shop.
export const PROTOCOL = 1;
export const MAX_LEVEL = 20;
export const INV_SIZE = 30;
export const MAX_PARTY = 4;

export const T = {
  GRASS: 0, WOOD: 1, ASH: 2, SNOW: 3, PATH: 4, TOWN: 5, WATER: 6, TREE: 7, ROCK: 8,
  DEADTREE: 9, PINE: 10, CRYPT_F: 11, CRYPT_W: 12, MINE_F: 13, MINE_W: 14, ICE_F: 15, ICE_W: 16,
};
export const TILE_COUNT = 17;
const WALK = new Uint8Array(TILE_COUNT);
for (const id of [0, 1, 2, 3, 4, 5, 11, 13, 15]) WALK[id] = 1;
export const isWalkable = (id) => WALK[id] === 1;

export const SLOTS = ['weapon', 'helm', 'chest', 'boots', 'ring'];
export const STATS = ['STR', 'AGI', 'INT', 'VIT'];

export const CLASSES = {
  warrior: {
    name: 'Warrior', primary: 'STR', weapon: 'Blade', color: 0xc0463c,
    blurb: 'Tough melee fighter. Wide swings, high health.',
    base: { STR: 8, AGI: 4, INT: 2, VIT: 8 }, growth: { STR: 2, AGI: 1, INT: 0, VIT: 2 },
    attack: { name: 'Slash', type: 'melee', range: 1.8, arc: 2.0, mult: 1, cd: 0.5 },
    skills: [
      { name: 'Whirlwind', lvl: 3, mp: 10, cd: 5, type: 'aoe', r: 2.5, mult: 1.8, desc: 'Hit every enemy around you.' },
      { name: 'Second Wind', lvl: 6, mp: 14, cd: 18, type: 'heal', pct: 0.3, desc: 'Restore 30% of your health.' },
    ],
  },
  ranger: {
    name: 'Ranger', primary: 'AGI', weapon: 'Bow', color: 0x4c9a52,
    blurb: 'Fast ranged attacker. High crit, keeps distance.',
    base: { STR: 3, AGI: 9, INT: 3, VIT: 5 }, growth: { STR: 1, AGI: 3, INT: 0, VIT: 1 },
    attack: { name: 'Shoot', type: 'proj', range: 8, speed: 16, mult: 0.9, cd: 0.5, color: 0xe8d9a0 },
    skills: [
      { name: 'Multishot', lvl: 3, mp: 12, cd: 5, type: 'proj', range: 8, speed: 16, count: 5, spread: 0.6, mult: 0.9, color: 0xe8d9a0, desc: 'Loose a fan of five arrows.' },
      { name: 'Piercing Shot', lvl: 6, mp: 18, cd: 8, type: 'proj', range: 10, speed: 22, pierce: true, mult: 2.4, color: 0xfff2b0, desc: 'A heavy arrow that passes through enemies.' },
    ],
  },
  mage: {
    name: 'Mage', primary: 'INT', weapon: 'Staff', color: 0x4f7fd6,
    blurb: 'Fragile spellcaster. Area damage and crowd control.',
    base: { STR: 2, AGI: 4, INT: 10, VIT: 4 }, growth: { STR: 0, AGI: 1, INT: 3, VIT: 1 },
    attack: { name: 'Arcane Bolt', type: 'proj', range: 7, speed: 13, mult: 1, cd: 0.6, color: 0x9ec3ff },
    skills: [
      { name: 'Fireball', lvl: 3, mp: 15, cd: 4, type: 'proj', range: 8, speed: 12, aoe: 2.2, mult: 1.9, color: 0xff8a3c, desc: 'Explodes on impact, burning everything nearby.' },
      { name: 'Frost Nova', lvl: 6, mp: 22, cd: 10, type: 'aoe', r: 3.2, mult: 1.4, slow: 3, desc: 'Damage and slow all enemies around you.' },
    ],
  },
};

// Enemy multipliers scale the per-level baseline in rules.enemyStats().
const E = (name, shape, color, o = {}) => ({ name, shape, color, hp: 1, atk: 1, spd: 2.6, aggro: 6, range: 1.2, cd: 1.3, size: 1, ...o });
const BOSS = { boss: true, hp: 11, atk: 1.35, size: 1.9, aggro: 9, spd: 2.4, slam: { r: 3.2, mult: 2.0, cd: 6.5, windup: 1.2 } };
export const ENEMIES = {
  slime: E('Green Slime', 'slime', 0x6cc24a, { hp: 0.8, atk: 0.8, spd: 2 }),
  boar: E('Wild Stag', 'beast', 0x9a6b43, { spd: 3 }),
  bandit: E('Road Bandit', 'humanoid', 0x8c4a4a, { atk: 1.1 }),
  wolf: E('Whisper Wolf', 'beast', 0x7d8590, { spd: 3.3, hp: 0.9 }),
  spider: E('Shroomling', 'bug', 0x6b4a86, { atk: 1.15, hp: 0.85 }),
  thornling: E('Forest Troll', 'golem', 0x4f7a3a, { hp: 1.4, spd: 2.1 }),
  imp: E('Ember Imp', 'wisp', 0xff7a3c, { range: 6, hp: 0.75, proj: 0xffa040 }),
  hound: E('Ash Hound', 'beast', 0x6a5350, { spd: 3.4 }),
  golem: E('Cinder Fiend', 'golem', 0x8a4330, { hp: 1.6, atk: 1.2, spd: 2 }),
  wisp: E('Frost Wisp', 'wisp', 0x9fe0ff, { range: 6, hp: 0.75, proj: 0xbfefff }),
  stalker: E('Rime Stalker', 'beast', 0xcfe6f2, { spd: 3.5 }),
  brute: E('Glacier Yeti', 'golem', 0x7fb2d6, { hp: 1.7, atk: 1.25, spd: 2 }),
  // Dungeon enemies are elites: tougher than open-world enemies of the same level.
  skeleton: E('Crypt Skeleton', 'humanoid', 0xd8d4c0, { hp: 1.5, atk: 1.05, elite: true }),
  ghoul: E('Ghoul', 'beast', 0x7a8f6a, { hp: 1.7, atk: 1.1, spd: 3.1, elite: true }),
  bonearcher: E('Bone Archer', 'humanoid', 0xbfb89a, { hp: 1.2, atk: 1.0, range: 6.5, proj: 0xe6e0c8, elite: true }),
  regent: E('The Bone Regent', 'humanoid', 0xb9a6ff, { ...BOSS, summon: 'skeleton' }),
  crawler: E('Mine Crawler', 'bug', 0x9a5a2c, { hp: 1.5, atk: 1.1, spd: 3.2, elite: true }),
  magmaimp: E('Magma Whelp', 'wisp', 0xff5a1f, { hp: 1.2, atk: 1.05, range: 6.5, proj: 0xff7a2a, elite: true }),
  slag: E('Slag Ogre', 'golem', 0x5a3a30, { hp: 2.0, atk: 1.15, spd: 2, elite: true }),
  magmaw: E('Magmaw', 'slime', 0xff4a1a, { ...BOSS, summon: 'crawler' }),
  revenant: E('Ice Revenant', 'humanoid', 0x8fc7e8, { hp: 1.6, atk: 1.1, elite: true }),
  rimecaster: E('Rime Caster', 'wisp', 0xc9f0ff, { hp: 1.2, atk: 1.05, range: 6.5, proj: 0xdff6ff, elite: true }),
  frostknight: E('Frost Ogre', 'golem', 0x5f8fbf, { hp: 2.0, atk: 1.15, spd: 2.2, elite: true }),
  vael: E('Vael the Rimebound', 'humanoid', 0x6fd0ff, { ...BOSS, hp: 13, summon: 'revenant' }),
};

export const WORLD = { w: 180, h: 140, seed: 20261, cx: 90, cy: 70 };

// Open-world zones are rings around town; `r` is the outer radius in tiles. `gear` is the
// uncommon tier that drops there.
export const ZONES = [
  { id: 'town', name: 'Emberhold', r: 9, safe: true, ground: T.TOWN },
  { id: 'meadow', name: 'Greenmeadow', r: 30, lv: [1, 4], ground: T.GRASS, tree: T.TREE, density: 0.64, gear: 'u1', mobs: [['slime', 5], ['boar', 4], ['bandit', 2]] },
  { id: 'wood', name: 'Whisperwood', r: 50, lv: [4, 8], ground: T.WOOD, tree: T.TREE, density: 0.56, gear: 'u2', mobs: [['wolf', 5], ['spider', 4], ['thornling', 2]] },
  { id: 'ash', name: 'Ashen Wastes', r: 70, lv: [8, 12], ground: T.ASH, tree: T.DEADTREE, density: 0.66, gear: 'u3', mobs: [['imp', 3], ['hound', 5], ['golem', 2]] },
  { id: 'frost', name: 'Frostreach', r: 999, lv: [12, 16], ground: T.SNOW, tree: T.PINE, density: 0.62, gear: 'u4', mobs: [['wisp', 3], ['stalker', 5], ['brute', 2]] },
];

export const DUNGEONS = {
  crypt: { name: 'The Hollow Crypt', minLevel: 4, lv: 5, bossLv: 7, boss: 'regent', x: 56, y: 58, floor: T.CRYPT_F, wall: T.CRYPT_W, rare: 'd1r', epic: 'd1e', mobs: [['skeleton', 5], ['ghoul', 3], ['bonearcher', 3]] },
  mines: { name: 'The Cinder Mines', minLevel: 9, lv: 10, bossLv: 12, boss: 'magmaw', x: 138, y: 42, floor: T.MINE_F, wall: T.MINE_W, rare: 'd2r', epic: 'd2e', mobs: [['crawler', 5], ['magmaimp', 3], ['slag', 3]] },
  sanctum: { name: 'Frostspire Sanctum', minLevel: 14, lv: 15, bossLv: 17, boss: 'vael', x: 165, y: 97, floor: T.ICE_F, wall: T.ICE_W, rare: 'd3r', epic: 'd3e', legendary: 'd3l', mobs: [['revenant', 5], ['rimecaster', 3], ['frostknight', 3]] },
};
export const DUNGEON_SIZE = { w: 64, h: 48 };

export const NPCS = [
  { id: 'captain', name: 'Captain Mara', role: 'quests', x: 87.5, y: 67.5, color: 0xd9b24c },
  { id: 'merchant', name: 'Odo the Merchant', role: 'shop', x: 93.5, y: 67.5, color: 0x7ac0a0 },
];

// ---- Items -------------------------------------------------------------------------------
export const RARITY = {
  common: { name: 'Common', mult: 1, color: '#c8c8c8' },
  uncommon: { name: 'Uncommon', mult: 1.15, color: '#5fd35f' },
  rare: { name: 'Rare', mult: 1.45, color: '#4f9dff' },
  epic: { name: 'Epic', mult: 1.75, color: '#b46bff' },
  legendary: { name: 'Legendary', mult: 2.1, color: '#ff9a2e' },
};

// Gear tiers. Open-world tiers (shop + drops) top out at uncommon; rare, epic and legendary
// tiers only come from dungeons.
export const TIERS = {
  c1: { prefix: 'Worn', rarity: 'common', ilvl: 1, source: 'shop' },
  c2: { prefix: 'Militia', rarity: 'common', ilvl: 5, source: 'shop' },
  c3: { prefix: 'Veteran', rarity: 'common', ilvl: 9, source: 'shop' },
  c4: { prefix: 'Tempered', rarity: 'common', ilvl: 13, source: 'shop' },
  u1: { prefix: "Hunter's", rarity: 'uncommon', ilvl: 3, source: 'world' },
  u2: { prefix: 'Wildwood', rarity: 'uncommon', ilvl: 7, source: 'world' },
  u3: { prefix: 'Ashforged', rarity: 'uncommon', ilvl: 11, source: 'world' },
  u4: { prefix: 'Rimeguard', rarity: 'uncommon', ilvl: 15, source: 'world' },
  d1r: { prefix: 'Cryptbound', rarity: 'rare', ilvl: 7, source: 'dungeon' },
  d1e: { prefix: "Bone Regent's", rarity: 'epic', ilvl: 8, source: 'dungeon' },
  d2r: { prefix: 'Cinderwrought', rarity: 'rare', ilvl: 12, source: 'dungeon' },
  d2e: { prefix: "Magmaw's", rarity: 'epic', ilvl: 13, source: 'dungeon' },
  d3r: { prefix: 'Frostspire', rarity: 'rare', ilvl: 17, source: 'dungeon' },
  d3e: { prefix: 'Rimebound', rarity: 'epic', ilvl: 18, source: 'dungeon' },
  d3l: { prefix: "Vael's", rarity: 'legendary', ilvl: 20, source: 'dungeon' },
};
const SLOT_NAME = { helm: 'Helm', chest: 'Cuirass', boots: 'Boots', ring: 'Signet' };

function buildItems() {
  const items = {
    hp_potion: { id: 'hp_potion', name: 'Health Potion', kind: 'potion', stack: 20, value: 12, heal: 0.4, rarity: 'common', desc: 'Restores 40% health.' },
    mp_potion: { id: 'mp_potion', name: 'Mana Potion', kind: 'potion', stack: 20, value: 12, mana: 0.5, rarity: 'common', desc: 'Restores 50% mana.' },
  };
  for (const [tid, t] of Object.entries(TIERS)) {
    const m = RARITY[t.rarity].mult, p = t.ilvl * m;
    const high = m >= 1.45; // rare and better carry bonus stats
    const base = { tier: tid, kind: 'gear', rarity: t.rarity, ilvl: t.ilvl, req: Math.max(1, t.ilvl - 1), value: Math.round(t.ilvl * 10 * m * m), source: t.source };
    const add = (slot, extra) => {
      const id = `${tid}_${slot}${extra.cls ? '_' + extra.cls : ''}`;
      items[id] = { id, slot, ...base, ...extra };
    };
    for (const [cid, c] of Object.entries(CLASSES)) {
      add('weapon', { cls: cid, name: `${t.prefix} ${c.weapon}`, mods: [{ stat: 'ATK', type: 'flat', value: Math.round(3 + p * 1.6) }, ...(high ? [{ stat: c.primary, type: 'flat', value: Math.round(p * 0.25) }] : [])] });
    }
    if (tid === 'd3l') { // legendary tier: weapons and a ring only
      add('ring', { name: `${t.prefix} ${SLOT_NAME.ring}`, mods: [{ stat: 'ATK', type: 'flat', value: Math.round(p * 0.5) }, { stat: 'CRIT', type: 'flat', value: 0.1 }, { stat: 'HP', type: 'pct', value: 0.1 }] });
      continue;
    }
    const vit = high ? [{ stat: 'VIT', type: 'flat', value: Math.round(p * 0.3) }] : [];
    add('chest', { name: `${t.prefix} ${SLOT_NAME.chest}`, mods: [{ stat: 'DEF', type: 'flat', value: Math.round(1 + p * 0.7) }, ...vit, ...(m >= 1.75 ? [{ stat: 'HP', type: 'pct', value: 0.08 }] : [])] });
    add('helm', { name: `${t.prefix} ${SLOT_NAME.helm}`, mods: [{ stat: 'DEF', type: 'flat', value: Math.round(1 + p * 0.45) }, ...vit] });
    add('boots', { name: `${t.prefix} ${SLOT_NAME.boots}`, mods: [{ stat: 'DEF', type: 'flat', value: Math.round(1 + p * 0.35) }, ...(high ? [{ stat: 'SPD', type: 'pct', value: m >= 1.75 ? 0.1 : 0.06 }] : [])] });
    add('ring', { name: `${t.prefix} ${SLOT_NAME.ring}`, mods: [{ stat: 'ATK', type: 'flat', value: Math.round(p * 0.5) }, ...(high ? [{ stat: 'CRIT', type: 'flat', value: m >= 1.75 ? 0.06 : 0.04 }] : [])] });
  }
  return items;
}
export const ITEMS = buildItems();

export const SHOP = ['hp_potion', 'mp_potion',
  ...Object.values(ITEMS).filter((i) => i.source === 'shop').map((i) => i.id)];

/** Item ids in a tier a given class can use (its own weapon + shared armour). */
export function tierItems(tier, cls) {
  return Object.values(ITEMS).filter((i) => i.tier === tier && (!i.cls || i.cls === cls)).map((i) => i.id);
}

// ---- Quests ------------------------------------------------------------------------------
// state: available -> active -> complete -> turned_in. Definitions are data; progress is saved.
export const QUESTS = [
  { id: 'q_slimes', name: 'Slime Trouble', level: 1, text: 'Slimes are fouling the wells outside the gate. Thin them out.', objectives: [{ target: 'slime', needed: 6 }], rewards: { xp: 120, gold: 25, items: [['hp_potion', 3]] } },
  { id: 'q_boars', name: 'Antler and Hide', level: 2, requires: 'q_slimes', text: 'The stags in Greenmeadow have turned vicious, and bandits ride with them. Bring them down.', objectives: [{ target: 'boar', needed: 6 }, { target: 'bandit', needed: 3 }], rewards: { xp: 300, gold: 50, items: [['u1_chest', 1]] } },
  { id: 'q_wolves', name: 'Into the Whisperwood', level: 4, requires: 'q_boars', text: 'Wolves and shroomlings rule the western wood. Clear a way to the old crypt.', objectives: [{ target: 'wolf', needed: 8 }, { target: 'spider', needed: 5 }], rewards: { xp: 800, gold: 110, items: [['u2_boots', 1], ['hp_potion', 5]] } },
  { id: 'q_crypt', name: 'The Bone Regent', level: 5, requires: 'q_wolves', text: 'Something commands the dead in the Hollow Crypt, west of here. End it. Do not go in unprepared.', objectives: [{ target: 'regent', needed: 1 }], rewards: { xp: 1800, gold: 300, items: [['hp_potion', 5]] } },
  { id: 'q_ash', name: 'Ash and Ember', level: 8, requires: 'q_wolves', text: 'The Ashen Wastes to the north-east are crawling with hounds and imps.', objectives: [{ target: 'hound', needed: 10 }, { target: 'imp', needed: 6 }], rewards: { xp: 2600, gold: 320, items: [['u3_helm', 1]] } },
  { id: 'q_mines', name: 'Heart of the Mines', level: 10, requires: 'q_ash', text: 'Magmaw nests at the bottom of the Cinder Mines. Its hoard is said to be worth the burns.', objectives: [{ target: 'magmaw', needed: 1 }], rewards: { xp: 5200, gold: 700, items: [['hp_potion', 8]] } },
  { id: 'q_frost', name: 'The Long Cold', level: 12, requires: 'q_ash', text: 'Scouts never return from Frostreach. Hunt what hunts them.', objectives: [{ target: 'stalker', needed: 12 }, { target: 'brute', needed: 5 }], rewards: { xp: 6500, gold: 800, items: [['u4_chest', 1]] } },
  { id: 'q_vael', name: 'The Rimebound', level: 15, requires: 'q_frost', text: 'Vael waits atop Frostspire Sanctum, far to the east. No finer arms exist than those he guards.', objectives: [{ target: 'vael', needed: 1 }], rewards: { xp: 12000, gold: 2000, items: [['hp_potion', 10]] } },
];
