// Smooth light: fades for modules whose lamps can't fade by themselves (Yandex), and the calm looping
// effects a scene can ask for: "breath" (brightness slowly rises and falls) and "fire" (warm, uneven flicker).
// The animator sits between the hub and a module's queue: set(id, value) in, push(id, value) out, a step at a time.
import { hexToRgb } from './util.mjs';

export const LOOP_FX = ['breath', 'fire'];
const BREATH_MS = 6000;
const FIRE = [255, 90, 16];
const OFF_FADE = 1.5; // seconds to dim out before "off"

const toHex = rgb => '#' + rgb.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, k) => toHex(hexToRgb(a).map((v, i) => v + (hexToRgb(b)[i] - v) * k));

// push(id, value) — the module's queue; rate — the module's sends a second; nativeFade — lamps fade by themselves;
// busy(id) — true while a one-off effect (lightning, blink) owns the lamp
export function makeAnimator({ push, rate, nativeFade, busy = () => false, now = Date.now, rand = Math.random, timers = true }) {
  const step = Math.max(1000 / rate, nativeFade ? 800 : 500); // native lamps fade between steps by themselves
  const lamps = new Map(); // id → { from, to, t0, dur, fx, shown }
  let timer = null;

  // what the lamp shows at time t: the fade's point, then the effect on top
  function valueAt(a, t) {
    const k = a.dur ? Math.min(1, (t - a.t0) / a.dur) : 1;
    let color = a.to.color, bri = a.to.bri;
    if (k < 1) { color = mix(a.from.color, a.to.color, k); bri = a.from.bri + (a.to.bri - a.from.bri) * k; }
    if (a.fx === 'breath') bri *= 0.35 + 0.65 * (0.5 + 0.5 * Math.cos(2 * Math.PI * (t - a.t0) / BREATH_MS));
    if (a.fx === 'fire') { bri *= 0.55 + 0.45 * rand(); color = mix(color, toHex(FIRE), 0.35 * rand()); }
    return { color, bri: Math.round(bri * 1000) / 1000, fade: Math.round(step) / 1000 };
  }
  const moving = (a, t) => a.fx || (!nativeFade && a.dur && t - a.t0 < a.dur);

  function tick() {
    const t = now();
    for (const [id, a] of lamps) {
      if (busy(id) || t < a.t0) continue; // t0 ahead: the lamp is still on its own fade
      if (a.to === 'off') { // faded out: now really off
        if (t - a.t0 >= a.dur) { lamps.delete(id); push(id, 'off'); }
        else { const v = valueAt({ ...a, to: { ...a.from, bri: 0 } }, t); a.shown = v; push(id, v); }
        continue;
      }
      a.shown = valueAt(a, t); push(id, a.shown);
      if (!moving(a, t)) lamps.delete(id);
    }
    if (timers) { clearTimeout(timer); timer = lamps.size ? setTimeout(tick, step) : null; }
  }

  return {
    step,
    set(id, v, prev) {
      const t = now(), was = lamps.get(id)?.shown ?? (prev && prev !== 'off' ? prev : null);
      const fx = v !== 'off' && LOOP_FX.includes(v.fx) ? v.fx : null;
      const dur = (v === 'off' ? OFF_FADE : v.fade || 0) * 1000;
      if (v === 'off') {
        if (nativeFade || !was || !dur) { lamps.delete(id); push(id, 'off'); return; }
        lamps.set(id, { from: was, to: 'off', t0: t, dur, fx: null });
      } else {
        if (!fx && (nativeFade || !dur)) { lamps.delete(id); push(id, v); return; } // the lamp handles it
        const from = was || { color: v.color, bri: 0.01 }; // from dark, in the new color
        lamps.set(id, { from, to: v, t0: t, dur: nativeFade ? 0 : dur, fx });
        if (nativeFade) { push(id, { color: v.color, bri: v.bri, fade: v.fade }); lamps.get(id).t0 = t + v.fade * 1000; } // fade first, the effect after
      }
      if (timers && !timer) timer = setTimeout(tick, nativeFade && fx ? Math.max(step, v.fade * 1000) : 0);
    },
    tick, // for tests
    active: id => lamps.has(id),
    stop() { clearTimeout(timer); timer = null; lamps.clear(); },
  };
}
