# Emberdeep

A small browser MMORPG: a shared open world to level up in, and instanced dungeons where the
best gear is. A three.js 3D client with animated low-poly characters and monsters by
[Quaternius](https://quaternius.com) (CC0), and an authoritative Node.js WebSocket server.
Terrain, trees, dungeons and effects are generated in code, and sounds are synthesised at
runtime.

Built with the skills in
[awesome-gamedev-agent-skills](https://github.com/SnyperWolfe/awesome-gamedev-agent-skills)
(see [Skills used](#skills-used)).

## Run it

### First time? Step by step

You need two free programs, installed once:

1. **Node.js** runs the game server. Download the **LTS** version from <https://nodejs.org>
   and install it with the default options.
2. **Git** downloads the game. Get it from <https://git-scm.com/downloads> and install it with
   the default options. (No Git? On the GitHub page click **Code → Download ZIP**, unzip it,
   and skip step 4 below.)

Then:

3. Open a terminal: on **Windows** press the Start key, type `PowerShell`, press Enter; on a
   **Mac** press Cmd+Space, type `Terminal`, press Enter.
4. Download the game (copy each line, paste it into the terminal, press Enter):

   ```bash
   git clone https://github.com/SnyperWolfe/emberdeep.git
   ```

5. Go into the game folder:

   ```bash
   cd emberdeep
   ```

6. Install what the game needs (only the first time, takes a minute):

   ```bash
   npm install
   ```

7. Start the server:

   ```bash
   npm start
   ```

   When it says `Emberdeep running at http://localhost:8080`, leave this window open.
8. Open your web browser (Chrome, Edge, Firefox or Safari) and go to <http://localhost:8080>.
9. Type a character name and a password, pick a class, and click **Enter the world**. Next time,
   use the same name and password to continue.

To stop the server, click the terminal window and press **Ctrl+C**. To play again later,
open a terminal and run `cd emberdeep` and then `npm start`.

**Playing with friends on the same Wi-Fi:** keep the server running, find your computer's
local IP address (Windows: run `ipconfig` and look for *IPv4 Address*; Mac: System Settings →
Wi-Fi → Details), and have friends open `http://YOUR-IP:8080`, for example
`http://192.168.1.20:8080`. If your computer asks whether to allow Node.js on the network,
choose **Allow**.

**If something goes wrong:**

- `npm` or `git` is "not recognized" / "command not found": close the terminal, open a new
  one, and try again. If it still fails, reinstall Node.js or Git.
- "Port 8080 is already in use" (`EADDRINUSE`): something else uses that port. Start on
  another one; on Mac run `PORT=3000 npm start`, on Windows PowerShell run
  `$env:PORT=3000; npm start`, then open <http://localhost:3000>.
- A black screen in the browser: the game needs WebGL. Update your browser, or turn on
  "Use graphics acceleration" in the browser's settings.

### Already set up

```bash
npm install
npm start
```

Open <http://localhost:8080>. Every character model, animated, is on
<http://localhost:8080/gallery.html> (add `?state=move`, `attack`, `hit` or `death` to see
other animations). `PORT` and `EMBERDEEP_DATA` (save directory, default `./data`) are
configurable. Run the tests with:

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
| Mouse wheel | Zoom |
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

**Looks.** Characters are modular, in the spirit of Quaternius's modular outfit packs: when you
create a character, pick a male or female body, then mix head, torso, legs and boots from a
knight and a traveler outfit, add a backpack, and choose one of six colour schemes and three
skin tones, with a live 3D preview. Change it any time for free at the **wardrobe** at Odo's
stall in town. Dungeon gear shows on your outfit: rare pieces tint the part they cover blue,
epic pieces purple and legendary pieces gold, and dungeon weapons glow, so other players can
see what you have earned.

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
  world3d.js  three.js view: camera, animated characters, movement prediction, overlay labels
  models.js   modular heroes (parts rebound to one skeleton), enemy/NPC models, animation states
  wardrobe.js look editor with live preview (character creation and the in-town wardrobe)
  terrain.js  low-poly ground, instanced trees/rocks/walls, town props, portals (chunked)
  fx.js       swings, rings, telegraphs, bursts, level-up pillars
  ui.js       DOM HUD: bars, action bar, bag, quests, shop, chat, minimap
  assets/     Quaternius models (.glb) and CREDITS.md     sfx.js  synthesised sounds
  gallery.html  every model animated, for checking art changes
```

- **Server authority.** Clients send intent only (move direction, attack angle, "buy X").
  The server simulates movement, combat and loot, and sends each client 10 snapshots a second
  containing only what is near that player. The client predicts its own movement with the
  same collision code and interpolates everyone else.
- **Persistence.** One JSON file per character with a schema version, written to a temp file,
  fsynced and renamed, keeping the previous save as `.bak`. Passwords are stored as scrypt
  hashes.
- **Art.** Characters are skinned glTF models cloned per entity with their own animation
  mixer (idle, run, attack, hit, death). Trees, rocks and walls are instanced and split into
  16x16-tile chunks so off-screen ones are culled.
- **Content is data.** Adding an enemy, item tier, quest or dungeon is an edit to
  `shared/content.js`.

## Skills used

Routed with the repo's `router` skill: a web project, first built on `phaser-core` (Phaser 4.2)
and later moved to three.js (the `threejs-*` skills) for 3D models, then:

| Skill | Where it shaped the game |
| --- | --- |
| `rpg` | Derived stats with a reversible gear modifier layer, quadratic XP curve, ratio damage mitigation, data-defined items, quest state machine |
| `procedural-gen` | Seeded RNG everywhere, rooms-and-corridors dungeons joined by a minimum spanning tree, flood-fill validation, capped placement loops, pity counter for legendary drops |
| `game-ai` | Enemy FSM (idle, chase, return), decision separate from steering, A* re-planned on a timer |
| `save-systems` | Versioned schema, migrations, atomic write, backup fallback, autosave on safe boundaries |
| `level-design` | Difficulty rings, teach-then-test quest chain, quiet clearings at dungeon doors, harder rooms deeper in |
| `game-feel` | Damage numbers, squash on hit, decaying camera trauma, tiered feedback (hit / crit / boss slam / boss kill) |
| `game-ui-ux` | Anchored flex HUD, event-driven updates, focusable panels, safe-area padding |
| `create-game-assets` | One art family (Quaternius low-poly, CC0) with recorded provenance in `client/assets/CREDITS.md`; procedural terrain built to match its faceted look; every model checked in a gallery and in game |
| `threejs-scene-setup`, `threejs-gltf-loading`, `threejs-materials-lighting` | Renderer, camera and lights; glTF + meshopt loading with skinned clones per entity; flat-shaded materials, shadows and dungeon torchlight |
| `camera-systems` | Smoothed follow clamped to the map, shake applied to the camera only |
| `ebitengine-game` networking reference | Authoritative server model, per-player authorised views, input validation, two-real-peer tests |

## Limits

This is a complete small game, not a production MMO service: one server process holds the
whole world in memory, it has been tested with a handful of simultaneous players rather than
load-tested, and it serves plain HTTP/WS, so put it behind a TLS proxy before exposing it to
the internet. There is no trading, PvP or guild system.
