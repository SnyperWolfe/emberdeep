// DOM HUD. It listens to bus events and redraws only what changed; it never reads the scene.
import { CLASSES, ITEMS, QUESTS, RARITY, SHOP, SLOTS, DUNGEONS, NPCS, MAX_LEVEL } from '/shared/content.js';
import { derive, questStatus } from '/shared/rules.js';
import { state, bus, send } from './net.js';
import { sfx, toggleMute } from './sfx.js';
import { MINIMAP } from './palette.js';
import { LookEditor } from './wardrobe.js';

const $ = (id) => document.getElementById(id);
/** Element builder that only ever sets text (never HTML), so names and chat cannot inject markup. */
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v; else if (k === 'style') el.style.cssText = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el[k] = v;
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
}
const setBar = (fill, text, v, max) => { fill.style.width = `${Math.max(0, Math.min(100, (v / max) * 100))}%`; if (text) text.textContent = `${v} / ${max}`; };
const STAT_NAME = { ATK: 'Attack', DEF: 'Defense', HP: 'Health', MP: 'Mana', CRIT: 'Crit', SPD: 'Speed', STR: 'Strength', AGI: 'Agility', INT: 'Intellect', VIT: 'Vitality' };
const modText = (m) => (m.type === 'pct' || m.stat === 'CRIT' ? `+${Math.round(m.value * 100)}% ${STAT_NAME[m.stat]}` : `+${m.value} ${STAT_NAME[m.stat]}`);
const sellPrice = (item) => Math.max(1, Math.floor(item.value * 0.3));

let npcMode = null; // 'quests' | 'shop' | null

// ---- toasts & chat ---------------------------------------------------------------------------
function toast(text, color) {
  const el = h('div', { class: 'toast', textContent: text, style: color ? `color:${color}` : '' });
  $('toasts').append(el);
  setTimeout(() => el.remove(), 3300);
  while ($('toasts').children.length > 5) $('toasts').firstChild.remove();
}

function chatLine(m) {
  const log = $('chatlog');
  log.append(h('div', { class: m.ch }, m.from ? h('b', { textContent: `${m.ch === 'party' ? '[Party] ' : ''}${m.from}: ` }) : null, m.text));
  while (log.children.length > 80) log.firstChild.remove();
  log.scrollTop = log.scrollHeight;
}

// ---- tooltips --------------------------------------------------------------------------------
function showTip(ev, id, context) {
  const item = ITEMS[id], you = state.you, tip = $('tooltip');
  const rows = [h('b', { textContent: item.name, style: `color:${RARITY[item.rarity].color}` })];
  if (item.kind === 'gear') {
    rows.push(h('div', { class: 'muted', textContent: `${RARITY[item.rarity].name} ${item.slot} · item level ${item.ilvl}` }));
    for (const m of item.mods) rows.push(h('div', { textContent: modText(m) }));
    if (item.cls) rows.push(h('div', { class: item.cls === you.cls ? 'muted' : 'bad', textContent: `${CLASSES[item.cls].name} only` }));
    rows.push(h('div', { class: you.level >= item.req ? 'muted' : 'bad', textContent: `Requires level ${item.req}` }));
    if (item.source === 'dungeon') rows.push(h('div', { class: 'muted', textContent: 'Dungeon drop' }));
    if (context !== 'equipped' && (!item.cls || item.cls === you.cls)) {
      const cur = derive(you), next = derive({ ...you, equip: { ...you.equip, [item.slot]: id } });
      for (const [k, label] of [['attack', 'Attack'], ['defense', 'Defense'], ['maxHp', 'Health']]) {
        const d = next[k] - cur[k];
        if (d) rows.push(h('div', { class: d > 0 ? 'good' : 'bad', textContent: `${d > 0 ? '+' : ''}${d} ${label} if equipped` }));
      }
    }
  } else rows.push(h('div', { textContent: item.desc }));
  rows.push(h('div', { class: 'muted', textContent: context === 'shop' ? `Costs ${item.value} gold` : npcMode === 'shop' && context === 'bag' ? `Click to sell for ${sellPrice(item)} gold (Shift: whole stack)` : context === 'bag' ? (item.kind === 'gear' ? 'Click to equip' : 'Click to use') : context === 'equipped' ? 'Click to unequip' : '' }));
  tip.replaceChildren(...rows);
  tip.hidden = false;
  const r = ev.currentTarget.getBoundingClientRect();
  tip.style.left = `${Math.max(8, Math.min(window.innerWidth - 230, r.left - 228))}px`;
  tip.style.top = `${Math.max(8, Math.min(window.innerHeight - tip.offsetHeight - 8, r.top))}px`;
}
const hideTip = () => { $('tooltip').hidden = true; };
const tipProps = (id, context) => ({ onmouseenter: (e) => showTip(e, id, context), onfocus: (e) => showTip(e, id, context), onmouseleave: hideTip, onblur: hideTip });

function isUpgrade(item) {
  const you = state.you;
  if (item.kind !== 'gear' || (item.cls && item.cls !== you.cls) || you.level < item.req) return false;
  const cur = ITEMS[you.equip[item.slot]];
  return !cur || item.ilvl * RARITY[item.rarity].mult > cur.ilvl * RARITY[cur.rarity].mult;
}

// ---- panels ----------------------------------------------------------------------------------
function panelHead(title, close) {
  return h('h2', {}, title, h('button', { textContent: 'Close (Esc)', onclick: close }));
}

function renderBag() {
  const panel = $('panel-bag'), you = state.you;
  if (panel.hidden) return;
  const s = you.stats;
  const equipCells = SLOTS.map((slot) => {
    const id = you.equip[slot], item = ITEMS[id];
    return item
      ? h('button', { class: 'cell full', style: `--rc:${RARITY[item.rarity].color}`, onclick: () => { hideTip(); send({ t: 'unequip', slot }); }, ...tipProps(id, 'equipped') }, item.name)
      : h('div', { class: 'cell' }, h('span', { class: 'lbl', textContent: slot }));
  });
  const cells = you.inv.map((st, i) => {
    if (!st) return h('div', { class: 'cell' });
    const item = ITEMS[st.id];
    const click = (e) => {
      hideTip();
      if (npcMode === 'shop') send({ t: 'sell', slot: i, all: e.shiftKey });
      else if (item.kind === 'gear') send({ t: 'equip', slot: i });
      else send({ t: 'potion', k: item.mana ? 'mp' : 'hp' });
    };
    return h('button', { class: 'cell full', style: `--rc:${RARITY[item.rarity].color}`, onclick: click, ...tipProps(st.id, 'bag') },
      item.name, st.n > 1 ? h('span', { class: 'n', textContent: st.n }) : null, isUpgrade(item) ? h('span', { class: 'up', textContent: '▲' }) : null);
  });
  const stat = (label, v) => h('div', {}, h('span', { textContent: `${label} ` }), String(v));
  panel.replaceChildren(
    panelHead(`${you.name} — level ${you.level} ${CLASSES[you.cls].name}`, () => togglePanel('panel-bag', false)),
    h('h3', { textContent: 'Equipped' }), h('div', { class: 'equip' }, equipCells),
    h('div', { class: 'stats' }, stat('Attack', s.attack), stat('Defense', s.defense), stat('Crit', `${Math.round(s.crit * 100)}%`),
      stat('Health', s.maxHp), stat('Mana', s.maxMp), stat('Speed', s.speed.toFixed(1)),
      stat('STR', s.STR), stat('AGI', s.AGI), stat('INT', s.INT), stat('VIT', s.VIT), stat('Gold', you.gold)),
    h('h3', { textContent: npcMode === 'shop' ? 'Bag — click an item to sell it' : 'Bag' }), h('div', { class: 'grid' }, cells),
    h('div', { class: 'muted', textContent: 'Rare, epic and legendary gear drops only inside dungeons.' }),
  );
}

function renderNpc() {
  const panel = $('panel-npc'), you = state.you;
  if (panel.hidden) return;
  const close = () => togglePanel('panel-npc', false);
  if (npcMode === 'shop') {
    const rows = SHOP.map((id) => ITEMS[id]).filter((i) => !i.cls || i.cls === you.cls).map((item) => h('div', { class: 'row' },
      h('div', { class: 'grow', tabIndex: 0, style: `color:${RARITY[item.rarity].color}`, ...tipProps(item.id, 'shop') }, item.name, item.kind === 'gear' ? h('span', { class: 'muted', textContent: `  ${item.slot}, level ${item.req}` }) : null),
      h('span', { style: 'color:#f0c95a', textContent: `${item.value}g` }),
      h('button', { textContent: 'Buy', disabled: you.gold < item.value, onclick: () => send({ t: 'buy', id: item.id }) })));
    panel.replaceChildren(panelHead('Odo the Merchant', close),
      h('div', { class: 'row' }, h('div', { class: 'grow muted', textContent: 'Mix and match outfit pieces, colours and skin tone — free of charge.' }), h('button', { textContent: 'Change outfit', onclick: openWardrobe })),
      h('div', { class: 'muted', textContent: `You have ${you.gold} gold. Open your bag (I) and click items to sell them. The finest gear is never for sale — it is taken from dungeon bosses.` }), ...rows);
    return;
  }
  const rows = [];
  for (const q of QUESTS) {
    const status = questStatus(you, q), st = you.quests[q.id];
    if (status === 'locked' || status === 'turned_in') continue;
    const rewards = [`${q.rewards.xp} XP`, `${q.rewards.gold} gold`, ...(q.rewards.items || []).map(([id, n]) => `${n > 1 ? n + '× ' : ''}${ITEMS[id].name}`)].join(', ');
    const button = status === 'available'
      ? h('button', { textContent: 'Accept', disabled: you.level < q.level - 1, onclick: () => send({ t: 'quest', op: 'accept', id: q.id }) })
      : status === 'complete' ? h('button', { textContent: 'Turn in', onclick: () => send({ t: 'quest', op: 'turnin', id: q.id }) })
      : h('span', { class: 'muted', textContent: 'In progress' });
    rows.push(h('div', { class: 'row quest' }, h('div', { class: 'grow' },
      h('b', { textContent: `${q.name} ` }), h('span', { class: 'muted', textContent: `level ${q.level}` }),
      h('p', { textContent: q.text }),
      h('p', { class: 'obj', textContent: q.objectives.map((o, i) => `${objName(o)} ${st ? st.counts[i] : 0}/${o.needed}`).join(' · ') }),
      h('p', { class: 'rew', textContent: `Reward: ${rewards}` })), button));
  }
  const done = QUESTS.filter((q) => you.quests[q.id]?.state === 'turned_in').length;
  panel.replaceChildren(panelHead('Captain Mara', close),
    h('div', { class: 'muted', textContent: rows.length ? `Quests completed: ${done}/${QUESTS.length}` : 'You have done everything I can ask of you, champion.' }), ...rows);
}

const ENEMY_NAMES = {};
function objName(o) { return ENEMY_NAMES[o.target] || o.target; }

function renderTracker() {
  const you = state.you, kids = [];
  for (const q of QUESTS) {
    const st = you.quests[q.id];
    if (!st || st.state === 'turned_in') continue;
    kids.push(h('b', { textContent: q.name }));
    if (st.state === 'complete') kids.push(h('div', { class: 'done', textContent: 'Return to Captain Mara' }));
    else q.objectives.forEach((o, i) => kids.push(h('div', { class: st.counts[i] >= o.needed ? 'done' : '', textContent: `${objName(o)}: ${st.counts[i]}/${o.needed}` })));
  }
  if (!kids.length && Object.keys(you.quests).length < QUESTS.length) kids.push(h('div', { class: 'muted', textContent: 'Talk to Captain Mara in town for work.' }));
  $('tracker').replaceChildren(...kids);
}

let wardrobe = null;
function openWardrobe() {
  const panel = $('panel-wardrobe');
  if (!wardrobe) {
    const body = h('div');
    wardrobe = new LookEditor(body, { look: state.you.look, getCls: () => state.you.cls });
    panel.replaceChildren(panelHead('Wardrobe', () => togglePanel('panel-wardrobe', false)), body,
      h('div', { class: 'muted', textContent: 'Dungeon gear you wear also shows on your outfit: rare pieces tint it blue, epic purple and legendary gold.' }),
      h('div', { class: 'row' }, h('span', { class: 'grow' }),
        h('button', { textContent: 'Cancel', onclick: () => togglePanel('panel-wardrobe', false) }),
        h('button', { textContent: 'Save outfit', onclick: () => { send({ t: 'look', look: wardrobe.look }); togglePanel('panel-wardrobe', false); } })));
  }
  wardrobe.setLook(state.you.look);
  togglePanel('panel-npc', false); togglePanel('panel-bag', false);
  togglePanel('panel-wardrobe', true);
}

function togglePanel(id, show) {
  const panel = $(id);
  panel.hidden = show === undefined ? !panel.hidden : !show;
  hideTip();
  if (id === 'panel-npc' && panel.hidden) { npcMode = null; }
  renderBag(); renderNpc();
  if (!panel.hidden) panel.querySelector('button')?.focus({ preventScroll: true }); // always focus something on open
  else document.activeElement?.blur();
}

// ---- action bar ------------------------------------------------------------------------------
const slots = {};
function buildActions() {
  const cls = CLASSES[state.you.cls];
  const defs = [['a', 'LMB', cls.attack.name], ['s0', '1', cls.skills[0].name], ['s1', '2', cls.skills[1].name], ['hp', 'Q', 'Health Potion'], ['mp', 'R', 'Mana Potion']];
  $('actions').replaceChildren(...defs.map(([k, key, name]) => {
    const info = h('em'), cd = h('div', { class: 'cd' });
    slots[k] = { el: h('div', { class: 'slot', title: name }, h('kbd', { textContent: key }), name, info, cd), info, cd };
    return slots[k].el;
  }));
  const s0 = cls.skills[0], s1 = cls.skills[1];
  slots.s0.el.title = `${s0.name}: ${s0.desc} (${s0.mp} mana)`;
  slots.s1.el.title = `${s1.name}: ${s1.desc} (${s1.mp} mana)`;
}

function renderActions() {
  const you = state.you, cls = CLASSES[you.cls];
  cls.skills.forEach((s, i) => {
    const locked = you.level < s.lvl;
    slots['s' + i].el.classList.toggle('locked', locked);
    slots['s' + i].info.textContent = locked ? `Lv ${s.lvl}` : `${s.mp} mp`;
  });
  const count = (id) => you.inv.reduce((n, s) => n + (s && s.id === id ? s.n : 0), 0);
  slots.hp.info.textContent = `×${count('hp_potion')}`;
  slots.mp.info.textContent = `×${count('mp_potion')}`;
}

function startCooldown(k, seconds) {
  for (const key of k === 'pot' ? ['hp', 'mp'] : [k]) {
    slots[key]?.cd.animate([{ height: '100%' }, { height: '0%' }], { duration: seconds * 1000 });
  }
}

// ---- minimap ---------------------------------------------------------------------------------
let mapBase = null;
function buildMinimap() {
  const m = state.map;
  mapBase = document.createElement('canvas');
  mapBase.width = m.w; mapBase.height = m.h;
  const g = mapBase.getContext('2d');
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) { g.fillStyle = MINIMAP[m.tiles[y * m.w + x]]; g.fillRect(x, y, 1, 1); }
  const c = $('minimap'), scale = m.kind === 'world' ? 2 : 4;
  c.width = m.w * scale; c.height = m.h * scale;
  document.body.classList.toggle('dungeon', m.kind === 'dungeon');
}

function drawMinimap(s) {
  if (!mapBase) return;
  const c = $('minimap'), g = c.getContext('2d'), k = c.width / state.map.w;
  g.imageSmoothingEnabled = false;
  g.drawImage(mapBase, 0, 0, c.width, c.height);
  const dot = (x, y, color, r = 3) => { g.fillStyle = '#000'; g.fillRect(x * k - r - 1, y * k - r - 1, r * 2 + 2, r * 2 + 2); g.fillStyle = color; g.fillRect(x * k - r, y * k - r, r * 2, r * 2); };
  if (state.map.kind === 'world') {
    for (const d of Object.values(DUNGEONS)) dot(d.x + 0.5, d.y + 0.5, state.you.level >= d.minLevel ? '#c88bff' : '#6b5a80', 4);
    for (const n of NPCS) dot(n.x, n.y, '#ffd24a', 2);
  }
  for (const e of s.e) if (e.k === 'o' && e.ex) dot(e.x, e.y, '#58e08a', 4); else if (e.k === 'm' && e.b) dot(e.x, e.y, '#ff5a2e', 4);
  for (const p of s.pt) if (p.here) dot(p.x, p.y, '#7fc4ff');
  dot(s.x, s.y, '#ffffff');
}

// ---- wiring ----------------------------------------------------------------------------------
export function initUI() {
  let last = {}, frame = 0, wasDead = false;

  $('panel-help').replaceChildren(panelHead('How to play', () => togglePanel('panel-help', false)),
    h('table', {}, ...[
      ['W A S D', 'Move'], ['Mouse', 'Aim'], ['Left click / Space', 'Attack (hold to keep attacking)'], ['1, 2', 'Class skills (unlock at levels 3 and 6)'],
      ['Q, R', 'Drink a health / mana potion'], ['E', 'Talk to people, enter and leave dungeons'], ['I', 'Bag, equipment and stats'],
      ['Enter', 'Chat. /invite <name> and /accept form a party'], ['H, M', 'This help, mute sound'],
    ].map(([a, b]) => h('tr', {}, h('td', { textContent: a }), h('td', { textContent: b })))),
    h('p', { class: 'muted', textContent: 'Fight in the open world to level up and collect gear — enemies get tougher the farther you travel from Emberhold. The three dungeons (purple markers on the minimap) are level-gated, full of elite enemies, and their bosses drop the best gear in the game. Bring friends: a party shares one dungeon instance.' }));

  bus.on('you', () => {
    const you = state.you;
    if (!slots.a) { buildActions(); for (const [id, e] of Object.entries(ENEMY_NAMES_SRC)) ENEMY_NAMES[id] = e.name; }
    $('who').textContent = `${you.name} · Level ${you.level} ${CLASSES[you.cls].name}`;
    $('gold').textContent = `${you.gold} gold`;
    if (you.level >= MAX_LEVEL) { $('xpfill').style.width = '100%'; $('xptext').textContent = 'Max level'; }
    else { setBar($('xpfill'), null, you.xp, you.xpNext); $('xptext').textContent = `Level ${you.level} — ${you.xp} / ${you.xpNext} XP`; }
    renderActions(); renderTracker(); renderBag(); renderNpc();
  });

  bus.on('map', buildMinimap);
  if (state.map) buildMinimap();

  bus.on('s', (s) => {
    const max = state.you.stats;
    if (s.hp !== last.hp || max.maxHp !== last.maxHp) setBar($('hpfill'), $('hptext'), s.hp, max.maxHp);
    if (s.mp !== last.mp || max.maxMp !== last.maxMp) setBar($('mpfill'), $('mptext'), s.mp, max.maxMp);
    if (s.z !== last.z) $('zone').textContent = s.z;
    last = { hp: s.hp, mp: s.mp, z: s.z, maxHp: max.maxHp, maxMp: max.maxMp };
    if (!!s.d !== wasDead) { wasDead = !!s.d; $('dead').hidden = !wasDead; }

    const boss = s.e.find((e) => e.k === 'm' && e.b);
    $('boss').hidden = !boss;
    if (boss) { $('bossname').textContent = `${boss.n} — level ${boss.l}`; $('bossfill').style.width = `${(boss.hp / boss.mh) * 100}%`; }

    let near = null, nd = 2.2;
    for (const e of s.e) if (e.k === 'n' || e.k === 'o') { const d = Math.hypot(e.x - s.x, e.y - s.y); if (d < nd) { near = e; nd = d; } }
    $('hint').hidden = !near;
    if (near) $('hint').textContent = near.k === 'n' ? `E — Talk to ${near.n}` : near.ex ? 'E — Leave the dungeon' : `E — Enter ${near.n} (level ${near.lv}+)`;
    if (npcMode && !s.e.some((e) => e.k === 'n' && Math.hypot(e.x - s.x, e.y - s.y) < 4.5)) togglePanel('panel-npc', false);

    $('party').replaceChildren(...s.pt.map((p) => h('div', { class: 'member' }, `${p.n} · ${p.l}${p.here ? '' : ' (away)'}`, h('div', { class: 'bar hp' }, h('i', { style: `width:${(p.hp / p.mh) * 100}%` })))));
    if (frame++ % 2 === 0) drawMinimap(s);
  });

  bus.on('cd', (m) => startCooldown(m.k, m.d));
  bus.on('chat', chatLine);
  bus.on('note', (m) => toast(m.text, '#ffb0a8'));
  bus.on('loot', (m) => { const item = ITEMS[m.id]; toast(`Loot: ${m.n > 1 ? m.n + '× ' : ''}${item.name}`, RARITY[item.rarity].color); chatLine({ ch: 'sys', text: `You receive ${m.n > 1 ? m.n + '× ' : ''}${item.name}.` }); sfx.loot(); });
  bus.on('open', (m) => { npcMode = m.ui; togglePanel('panel-npc', true); if (m.ui === 'shop') togglePanel('panel-bag', true); });
  bus.on('invite', (m) => {
    const el = h('div', { class: 'toast sticky' }, `${m.from} invites you to a party`,
      h('button', { textContent: 'Accept', onclick: () => { send({ t: 'chat', text: '/accept' }); el.remove(); } }),
      h('button', { textContent: 'Decline', onclick: () => el.remove() }));
    $('toasts').append(el);
    setTimeout(() => el.remove(), 60000);
  });

  const chat = $('chatinput');
  chat.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { if (chat.value.trim()) send({ t: 'chat', text: chat.value }); chat.value = ''; chat.blur(); }
    else if (e.key === 'Escape') chat.blur();
    e.stopPropagation();
  });
  bus.on('key', (e) => {
    if (e.code === 'Enter') { chat.focus(); e.preventDefault(); }
    else if (e.code === 'KeyI' || e.code === 'KeyB') togglePanel('panel-bag');
    else if (e.code === 'KeyH') togglePanel('panel-help');
    else if (e.code === 'KeyM') $('btn-mute').click();
    else if (e.code === 'Escape') for (const id of ['panel-npc', 'panel-bag', 'panel-help', 'panel-wardrobe']) togglePanel(id, false);
  });
  $('btn-bag').onclick = () => togglePanel('panel-bag');
  $('btn-help').onclick = () => togglePanel('panel-help');
  $('btn-mute').onclick = (e) => { e.currentTarget.textContent = `Sound: ${toggleMute() ? 'off' : 'on'}`; e.currentTarget.blur(); };
}

import { ENEMIES as ENEMY_NAMES_SRC } from '/shared/content.js';
