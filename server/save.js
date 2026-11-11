// Account persistence: one versioned JSON file per character, written atomically
// (temp file + fsync + rename) with the previous good save kept as .bak.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { CLASSES, ITEMS, QUESTS, SLOTS, INV_SIZE, MAX_LEVEL, DEFAULT_LOOK } from '../shared/content.js';
import { SAVE_VERSION, normalizeLook } from '../shared/rules.js';

const scrypt = promisify(crypto.scrypt);

export class NewerSaveError extends Error {}

// Each migration is a pure function from one version's shape to the next.
const MIGRATIONS = {
  1: (d) => { // v1 had a 24-slot bag and no legendary pity counter
    d.pity = 0;
    d.inv = (d.inv || []).concat(new Array(INV_SIZE).fill(null)).slice(0, INV_SIZE);
    return d;
  },
  2: (d) => { // v3 added character looks; older characters keep their class's original look
    d.look = DEFAULT_LOOK[d.cls] || DEFAULT_LOOK.warrior;
    return d;
  },
};

export function migrate(data) {
  let v = Number.isInteger(data.version) ? data.version : 1;
  if (v > SAVE_VERSION) throw new NewerSaveError(`save is version ${v}, server understands ${SAVE_VERSION}`);
  while (v < SAVE_VERSION) { data = MIGRATIONS[v](data); data.version = ++v; }
  return data;
}

/** Repair anything a content change or hand edit could have broken. Throws if unusable. */
export function validate(d) {
  if (typeof d.name !== 'string' || !CLASSES[d.cls]) throw new Error('corrupt save: bad name/class');
  d.level = Math.min(MAX_LEVEL, Math.max(1, d.level | 0));
  d.xp = Math.max(0, d.xp | 0);
  d.gold = Math.max(0, d.gold | 0);
  d.pity = Math.max(0, d.pity | 0);
  d.look = normalizeLook(d.look, d.cls);
  const inv = Array.isArray(d.inv) ? d.inv : [];
  d.inv = Array.from({ length: INV_SIZE }, (_, i) => {
    const s = inv[i];
    return s && ITEMS[s.id] && s.n > 0 ? { id: s.id, n: Math.min(s.n | 0, ITEMS[s.id].stack || 1) } : null;
  });
  const eq = d.equip || {};
  d.equip = Object.fromEntries(SLOTS.map((s) => [s, ITEMS[eq[s]]?.slot === s ? eq[s] : null]));
  const quests = {};
  for (const q of QUESTS) {
    const st = d.quests?.[q.id];
    if (st && ['active', 'complete', 'turned_in'].includes(st.state)) {
      quests[q.id] = { state: st.state, counts: q.objectives.map((o, i) => Math.min(o.needed, Math.max(0, st.counts?.[i] | 0))) };
    }
  }
  d.quests = quests;
  if (!d.pos || !Number.isFinite(d.pos.x) || !Number.isFinite(d.pos.y)) d.pos = null;
  return d;
}

export class SaveStore {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
  }

  file(name) { return path.join(this.dir, `${name.toLowerCase()}.json`); }

  /** Returns the account, or null when none exists. Falls back to the .bak on a bad file. */
  load(name) {
    const file = this.file(name);
    let lastErr = null;
    for (const p of [file, file + '.bak']) {
      if (!fs.existsSync(p)) continue;
      try {
        return validate(migrate(JSON.parse(fs.readFileSync(p, 'utf8'))));
      } catch (err) {
        if (err instanceof NewerSaveError) throw err;
        lastErr = err;
      }
    }
    if (lastErr) throw lastErr;
    return null;
  }

  save(acc) {
    const file = this.file(acc.name), tmp = `${file}.tmp`;
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeSync(fd, JSON.stringify({ ...acc, version: SAVE_VERSION }));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    if (fs.existsSync(file)) fs.copyFileSync(file, file + '.bak');
    fs.renameSync(tmp, file); // atomic on POSIX: a crash leaves the old save or the new one
  }
}

export async function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: (await scrypt(password, salt, 32)).toString('hex') };
}

export async function checkPassword(password, auth) {
  const got = await scrypt(password, auth.salt, 32);
  const want = Buffer.from(auth.hash, 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}
