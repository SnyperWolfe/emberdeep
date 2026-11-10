// Boot: start fetching models, login screen -> connect -> start the 3D world and the HUD
// once the server accepts us and the models are ready.
import { CLASSES } from '/shared/content.js';
import { state, bus, connect } from './net.js';
import { initAudio } from './sfx.js';
import { initUI } from './ui.js';
import { World } from './world3d.js';
import { loadModels } from './models.js';

const $ = (id) => document.getElementById(id);
let started = false, modelsLoaded = 0;
const models = loadModels(undefined, (n, total) => { modelsLoaded = n / total; });

$('classes').replaceChildren(...Object.entries(CLASSES).map(([id, c], i) => {
  const label = document.createElement('label'), radio = document.createElement('input'), b = document.createElement('b'), span = document.createElement('span');
  radio.type = 'radio'; radio.name = 'cls'; radio.value = id; radio.checked = i === 0;
  b.textContent = c.name; span.textContent = c.blurb;
  label.append(radio, b, span);
  return label;
}));
try { $('name').value = localStorage.getItem('emberdeep.name') || ''; } catch { /* storage blocked */ }

$('login').addEventListener('submit', (e) => {
  e.preventDefault();
  if (state.connected) return;
  initAudio(); // needs a user gesture
  const name = $('name').value.trim();
  $('loginmsg').textContent = 'Connecting…';
  try { localStorage.setItem('emberdeep.name', name); } catch { /* storage blocked */ }
  connect({ name, pass: $('pass').value, cls: document.querySelector('input[name=cls]:checked').value });
});

bus.on('error', (m) => { $('loginmsg').textContent = m.msg; });
bus.on('closed', (wasPlaying) => {
  if (!wasPlaying) { if ($('loginmsg').textContent === 'Connecting…') $('loginmsg').textContent = 'Could not reach the server.'; return; }
  $('lostmsg').textContent = $('lostmsg').textContent || 'The connection to the server was lost.';
  $('lost').hidden = false;
});
bus.on('kick', (m) => { $('lostmsg').textContent = m.msg; });

bus.on('you', async () => {
  if (started) return;
  started = true;
  const timer = setInterval(() => { $('loginmsg').textContent = `Loading models… ${Math.round(modelsLoaded * 100)}%`; }, 100);
  try { await models; } catch (err) { clearInterval(timer); $('loginmsg').textContent = 'Could not load the game models. Reload the page.'; console.error(err); return; }
  clearInterval(timer);
  $('login').hidden = true;
  $('hud').hidden = false;
  document.activeElement?.blur();
  initUI();
  bus.emit('you', state.you); // the HUD subscribed after this event started; replay it once
  new World($('game'));
  if (state.you.level === 1 && state.you.xp === 0) document.getElementById('btn-help').click();
});
