// Tiny synthesised sound effects (no audio files to license or load).
let ctx = null, muted = false;
export function initAudio() { try { ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); } catch { ctx = null; } }
export function toggleMute() { muted = !muted; return muted; }

function tone(freq, dur, { type = 'square', vol = 0.06, to = freq, delay = 0 } = {}) {
  if (!ctx || muted) return;
  const t = ctx.currentTime + delay, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(30, to), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t); o.stop(t + dur);
}

export const sfx = {
  swing: () => tone(320, 0.08, { type: 'triangle', to: 140, vol: 0.05 }),
  shoot: () => tone(700, 0.07, { type: 'triangle', to: 350, vol: 0.04 }),
  hit: () => tone(180, 0.07, { to: 90 }),
  crit: () => { tone(260, 0.09, { to: 90, vol: 0.08 }); tone(900, 0.06, { type: 'triangle', vol: 0.04 }); },
  hurt: () => tone(120, 0.14, { type: 'sawtooth', to: 60, vol: 0.07 }),
  kill: () => tone(240, 0.18, { type: 'triangle', to: 60, vol: 0.07 }),
  nova: () => tone(500, 0.25, { type: 'sawtooth', to: 80, vol: 0.05 }),
  slam: () => tone(90, 0.4, { type: 'sawtooth', to: 35, vol: 0.12 }),
  warn: () => tone(440, 0.12, { type: 'square', to: 440, vol: 0.04 }),
  loot: () => { tone(660, 0.08, { type: 'triangle' }); tone(990, 0.12, { type: 'triangle', delay: 0.08 }); },
  heal: () => tone(520, 0.2, { type: 'sine', to: 780, vol: 0.06 }),
  level: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, { type: 'triangle', delay: i * 0.09, vol: 0.07 })),
  death: () => tone(200, 0.6, { type: 'sawtooth', to: 40, vol: 0.08 }),
};
