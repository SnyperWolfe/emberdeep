# Emberdeep

A small browser MMORPG: a shared open world to level up in, and instanced dungeons where the
best gear is. Phaser 4 client, authoritative Node.js WebSocket server, no art or audio files:
every sprite is drawn in code at 2x resolution with cel shading and a 4-frame walk/idle cycle,
and sounds are synthesised at runtime.

Built with the skills in
[awesome-gamedev-agent-skills](https://github.com/SnyperWolfe/awesome-gamedev-agent-skills)
(see [Skills used](#skills-used)).

## Run it

```bash
cd games/emberdeep
npm install
npm start
```

Open <http://localhost:8080>. Every character sprite, animated, is on
<http://localhost:8080/sprites.html> (add `?walk` to see the walk cycle). Pick a name, a password and a class; a new name creates a
character, an existing name logs in. Open a second tab (or have a friend connect to your
machine) to play together. `PORT` and `EMBERDEEP_DATA` (save directory, default `./data`)
are configurable.

```bash
npm test
```

## How to play

| Key | Action |
| --- | --- |
| `W A S D` | Move |
| Mouse, left click / `Space` | Aim, attack (hold to keep attacking) |
| `1`, `2` | Class skills (unlock at levels 3 and 6) |
| `Q`, `R` | Health / mana potion |
| `E` | Talk to NPCs, enter and leave dungeons |
| `I` | Bag, equipment and stats |
| `Enter` | Chat; `/invite <name>`, `/accept`, `/leave`, `/p <msg>`, `/who` |
| `H`, `M` | Help, mute |

## The game

**Open world.** Emberhold (a safe town) sits in the middle of a 180x140 world. Four zones
ring it, and enemies get tougher the farther out you go:

| Zone | Enemy levels | Gear that drops |
| --- | --- | --- |
| Greenmeadow | 1-4 | Hunter's (uncommon) |
| Whisperwood | 4-8 | Wildwood (uncommon) |
| Ashen Wastes | 8-12 | Ashforged (uncommon) |
| Frostreach | 12-16 | Rimeguard (uncommon) |

Captain Mara gives a quest chain that walks you outward; Odo sells potions and common gear.
Killing things far below your level gives little XP, so you keep moving.

**Dungeons.** Three level-gated dungeons (purple markers on the minimap). Each run is a
freshly generated layout, private to you or your party, filled with elite enemies and ending
in a boss with a telegraphed slam and reinforcements at half health.

| Dungeon | Min level | Boss | Drops |
| --- | --- | --- | --- |
| The Hollow Crypt | 4 | The Bone Regent (7) | Cryptbound (rare), Bone Regent's (epic) |
| The Cinder Mines | 9 | Magmaw (12) | Cinderwrought (rare), Magmaw's (epic) |
| Frostspire Sanctum | 14 | Vael the Rimebound (17) | Frostspire (rare), Rimebound (epic), Vael's (legendary) |

Rare, epic and legendary gear **only** drops in dungeons; the shop and the open world stop at
uncommon. Each boss's epics beat everything in the surrounding zone and the next one. The
minimum level gets you through the door, not through the boss: in simulated solo runs a
warrior in zone-appropriate gear loses to each boss at the entry level and wins two or three
levels later, so levelling and gearing up outside first is the intended way in. A party
(up to 4, shared XP bonus, personal loot for everyone) makes it easier.

**Classes.** Warrior (melee, tanky), Ranger (fast ranged, crits), Mage (area damage, slow).

## How it is built

```
shared/   rules and content used by both sides (and the tests)
  content.js  all game data: classes, enemies, zones, dungeons, items, quests
  rules.js    stats, damage, XP curve, inventory, quest state machine
  mapgen.js   overworld + dungeon generation (seeded, validated by flood fill)
  path.js     A* for enemy pathing     collide.js  tile collision
server/
  game.js     authoritative simulation: 20 Hz tick, AI, combat, loot, parties, instances
  index.js    static files + WebSocket gateway (validation, rate limit, accounts)
  save.js     versioned JSON saves, atomic writes, .bak fallback, migrations
client/
  scene.js    Phaser scene: tilemap, entity interpolation, movement prediction, feedback
  ui.js       DOM HUD: bars, action bar, bag, quests, shop, chat, minimap
  art.js      procedural tiles and sprites (visual rules documented at the top)
  sprites.html  animated contact sheet of every sprite     sfx.js  synthesised sounds
```

- **Server authority.** Clients send intent only (move direction, attack angle, "buy X").
  The server simulates movement, combat and loot, and sends each client 10 snapshots a second
  containing only what is near that player. The client predicts its own movement with the
  same collision code and interpolates everyone else.
- **Persistence.** One JSON file per character with a schema version, written to a temp file,
  fsynced and renamed, keeping the previous save as `.bak`. Passwords are stored as scrypt
  hashes.
- **Content is data.** Adding an enemy, item tier, quest or dungeon is an edit to
  `shared/content.js`.

## Skills used

Routed with the repo's `router` skill: new web project, so `phaser-core` (Phaser 4.2) for the
engine, then:

| Skill | Where it shaped the game |
| --- | --- |
| `rpg` | Derived stats with a reversible gear modifier layer, quadratic XP curve, ratio damage mitigation, data-defined items, quest state machine |
| `procedural-gen` | Seeded RNG everywhere, rooms-and-corridors dungeons joined by a minimum spanning tree, flood-fill validation, capped placement loops, pity counter for legendary drops |
| `game-ai` | Enemy FSM (idle, chase, return), decision separate from steering, A* re-planned on a timer |
| `save-systems` | Versioned schema, migrations, atomic write, backup fallback, autosave on safe boundaries |
| `level-design` | Difficulty rings, teach-then-test quest chain, quiet clearings at dungeon doors, harder rooms deeper in |
| `game-feel` | Damage numbers, squash on hit, decaying camera trauma, tiered feedback (hit / crit / boss slam / boss kill) |
| `game-ui-ux` | Anchored flex HUD, event-driven updates, focusable panels, safe-area padding |
| `create-game-assets` | One written visual system (light direction, three-tone shading, tinted outlines, proportions), sprites built as families from shared archetypes, checked on a contact sheet and in game |
| `camera-systems` | Smoothed follow clamped to the map, shake applied to the camera only |
| `ebitengine-game` networking reference | Authoritative server model, per-player authorised views, input validation, two-real-peer tests |

## Limits

This is a complete small game, not a production MMO service: one server process holds the
whole world in memory, it has been tested with a handful of simultaneous players rather than
load-tested, and it serves plain HTTP/WS, so put it behind a TLS proxy before exposing it to
the internet. There is no trading, PvP or guild system.
