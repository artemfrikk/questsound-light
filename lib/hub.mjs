// The bridge's core: starts the modules the master set up, keeps the list of lamps, carries out the site's
// commands and publishes the state. Lamp ids on the site are "module:own id" (e.g. "homeassistant:light.ceiling").
// Secrets (fields marked secret) are kept in the config file only: the state says a secret is saved, never what it is.
import { makeQueue } from './queue.mjs';

export function makeHub({ modules, config, save, publish, log = () => { } }) {
  const mods = new Map(modules.map(m => [m.id, { m, ok: false, error: null, lamps: [], push: null, started: false, last: new Map() }]));
  const lampErr = new Map(); // full id → last error text

  function state() {
    const lamps = [], list = [];
    for (const [id, x] of mods) {
      const set = config.modules[id];
      list.push({
        id, name: x.m.name, configured: !!set, ok: x.ok, error: x.error, fast: !!x.m.fast,
        settings: x.m.settings.map(({ key, label, secret, optional, placeholder }) => ({ key, label, secret: !!secret, optional: !!optional, placeholder })),
        values: set ? Object.fromEntries(x.m.settings.map(f => [f.key, f.secret ? !!set[f.key] : set[f.key] ?? ''])) : {},
      });
      for (const l of x.lamps) { const fid = id + ':' + l.id; lamps.push({ id: fid, name: l.name, module: id, caps: l.caps || {}, ok: !lampErr.has(fid), error: lampErr.get(fid) }); }
    }
    return { lamps, modules: list, version: 1 };
  }
  let pubTimer = null;
  const changed = () => { clearTimeout(pubTimer); pubTimer = setTimeout(() => publish(state()), 50); };
  const publishNow = () => { clearTimeout(pubTimer); publish(state()); };

  async function startModule(id) {
    const x = mods.get(id), set = config.modules[id];
    if (x.started) { try { await x.m.stop(); } catch { } x.started = false; }
    x.lamps = []; x.ok = false; x.error = null;
    if (!set) return;
    const onError = (lid, e) => { lampErr.set(id + ':' + lid, String(e?.message || e)); log(`${x.m.name}: ${lid}: ${e?.message || e}`); changed(); };
    x.push = x.m.setMany
      ? makeQueue({ rate: x.m.rate, shared: true, onError, sendMany: async batch => {
        try { await x.m.setMany(batch); } catch (e) {
          if (!e.perId) throw e; // the whole call failed: every lamp of the batch gets the error
          for (const lid in batch) e.perId[lid] ? onError(lid, new Error(e.perId[lid])) : clearErr(id, lid);
          return;
        }
        for (const lid in batch) clearErr(id, lid);
      } })
      : makeQueue({ rate: x.m.rate, send: async (lid, v) => { await x.m.set(lid, v); clearErr(id, lid); }, onError });
    try {
      await x.m.start(set, msg => log(`${x.m.name}: ${msg}`));
      x.started = true;
      x.lamps = await x.m.discover();
      x.ok = true;
    } catch (e) { x.error = String(e?.message || e); log(`${x.m.name}: ${x.error}`); }
  }
  const clearErr = (id, lid) => { if (lampErr.delete(id + ':' + lid)) changed(); };
  const findLamp = fid => {
    const i = fid.indexOf(':'), x = mods.get(fid.slice(0, i)), lid = fid.slice(i + 1);
    const lamp = x?.ok && x.lamps.find(l => l.id === lid);
    return lamp ? { x, lid, lamp } : null;
  };

  return {
    state,
    async start() { for (const id of mods.keys()) await startModule(id); publishNow(); },
    async stop() { for (const x of mods.values()) if (x.started) try { await x.m.stop(); } catch { } },
    async handle(c) {
      switch (c?.cmd) {
        case 'set':
          for (const [fid, t] of Object.entries(c.lamps || {})) {
            const f = findLamp(fid);
            if (!f || !(t === 'off' || (t && /^#[0-9a-f]{6}$/i.test(t.color) && t.bri >= 0 && t.bri <= 1))) continue;
            const v = t === 'off' ? 'off' : { color: t.color.toLowerCase(), bri: +t.bri, fade: Math.max(0, Math.min(30, +t.fade || 0)) };
            f.x.last.set(f.lid, v); f.x.push(f.lid, v);
          }
          break;
        case 'fx':
          for (const fid of c.lamps || []) {
            const f = findLamp(fid);
            if (!f?.lamp.caps?.fast || !['lightning', 'flicker'].includes(c.kind) || f.x.fxBusy?.has(f.lid)) continue;
            const ms = Math.max(100, Math.min(10000, +c.ms || 600)), last = f.x.last.get(f.lid);
            (f.x.fxBusy ??= new Set()).add(f.lid);
            (f.x.m.fx ? f.x.m.fx(f.lid, c.kind, ms, last) : genericFx(f, c.kind, ms, last))
              .catch(e => log(`${f.x.m.name}: ${e.message}`))
              .finally(() => { f.x.fxBusy.delete(f.lid); const now = f.x.last.get(f.lid); if (now) f.x.push(f.lid, now === 'off' ? 'off' : { ...now, fade: 0.3 }); });
          }
          break;
        case 'identify': {
          const f = findLamp(String(c.lamp));
          if (f) (f.x.m.identify ? f.x.m.identify(f.lid) : blink(f)).catch(e => log(`${f.x.m.name}: ${e.message}`));
          break;
        }
        case 'scan':
          for (const [id, x] of mods) if (x.started) { try { x.lamps = await x.m.discover(); x.ok = true; x.error = null; } catch (e) { x.ok = false; x.error = String(e.message || e); } }
          publishNow();
          break;
        case 'config': {
          const x = mods.get(c.module); if (!x) break;
          if (c.settings == null) delete config.modules[c.module];
          else {
            const old = config.modules[c.module] || {}, next = {};
            // a changed address must not take the old secret along: a new host gets a token only if it is typed again
            const moved = x.m.settings.some(f => !f.secret && old[f.key] && typeof c.settings[f.key] === 'string' && c.settings[f.key].trim() !== old[f.key]);
            for (const f of x.m.settings) {
              const v = c.settings[f.key];
              next[f.key] = f.secret && (v == null || v === '') ? (moved ? '' : old[f.key] ?? '') : typeof v === 'string' ? v.trim().slice(0, 2000) : old[f.key] ?? '';
            }
            config.modules[c.module] = next;
          }
          save();
          await startModule(c.module);
          publishNow();
          break;
        }
        case 'hello': publishNow(); break; // a site opened the light tab and wants the state now
      }
    },
  };
}

// Effects from plain set calls, for modules without their own: a lightning strike (two white flashes)
// or a flicker (the lamp's own color dancing in brightness). The hub puts the lamp back afterwards.
async function genericFx(f, kind, ms, last) {
  const s = ms => new Promise(r => setTimeout(r, ms)), set = v => f.x.m.set(f.lid, v);
  const base = last && last !== 'off' ? last : { color: '#ffb25a', bri: 0.6 };
  if (kind === 'lightning') {
    await set({ color: '#ffffff', bri: 1, fade: 0 }); await s(Math.min(120, ms / 3));
    await set({ ...base, bri: base.bri * 0.3, fade: 0 }); await s(Math.min(150, ms / 3));
    await set({ color: '#ffffff', bri: 1, fade: 0 }); await s(Math.min(100, ms / 3));
  } else {
    const steps = Math.max(3, Math.min(10, Math.round(ms / 150)));
    for (let i = 0; i < steps; i++) { await set({ ...base, bri: base.bri * (0.45 + Math.random() * 0.55), fade: 0 }); await s(ms / steps); }
  }
}
// a lamp without its own "identify": on bright white, off, back on
async function blink(f) {
  const s = ms => new Promise(r => setTimeout(r, ms));
  await f.x.m.set(f.lid, { color: '#ffffff', bri: 1, fade: 0 }); await s(500);
  await f.x.m.set(f.lid, 'off'); await s(500);
  await f.x.m.set(f.lid, { color: '#ffffff', bri: 1, fade: 0 });
}
