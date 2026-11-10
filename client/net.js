// Connection + client state. Everything else subscribes to `bus` events instead of polling.
import { PROTOCOL } from '/shared/content.js';

const handlers = new Map();
export const bus = {
  on(evt, fn) { (handlers.get(evt) || handlers.set(evt, []).get(evt)).push(fn); },
  emit(evt, data) { for (const fn of handlers.get(evt) || []) fn(data); },
};

export const state = { you: null, map: null, snap: null, cds: {}, connected: false };

let ws = null;
export function send(msg) { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); }

export function connect(login) {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws.onopen = () => { state.connected = true; send({ t: 'login', v: PROTOCOL, ...login }); };
  ws.onclose = () => { const was = state.you; state.connected = false; bus.emit('closed', !!was); };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.t === 'you') state.you = m;
    else if (m.t === 'map') {
      const bin = atob(m.tiles), tiles = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) tiles[i] = bin.charCodeAt(i);
      state.map = { ...m, tiles };
    } else if (m.t === 's') state.snap = m;
    else if (m.t === 'cd') state.cds[m.k] = { until: performance.now() + m.d * 1000, d: m.d };
    bus.emit(m.t, m);
  };
}
