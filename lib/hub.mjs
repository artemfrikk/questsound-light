// The bridge's core: starts the modules the master set up, keeps the list of lamps, carries out the site's
// commands and publishes the state. Lamp ids on the site are "module:own id" (e.g. "homeassistant:light.ceiling").
// Secrets (fields marked secret) are kept in the config file only: the state says a secret is saved, never what it is.
import { makeQueue } from './queue.mjs';

export function makeHub({ modules, config, save, publish, log = () => { } }) {
  const mods = new Map(modules.map(m => [m.id, { m, ok: false, error: null, lamps: [], push: null, started: false }]));
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
      ? makeQueue({ rate: x.m.rate, shared: true, sendMany: async batch => { await x.m.setMany(batch); for (const lid in batch) clearErr(id, lid); }, onError })
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
            if (f && (t === 'off' || (t && /^#[0-9a-f]{6}$/i.test(t.color) && t.bri >= 0 && t.bri <= 1))) f.x.push(f.lid, t === 'off' ? 'off' : { color: t.color.toLowerCase(), bri: +t.bri, fade: Math.max(0, Math.min(30, +t.fade || 0)) });
          }
          break;
        case 'fx':
          for (const fid of c.lamps || []) {
            const f = findLamp(fid);
            if (f?.lamp.caps?.fast && f.x.m.fx && ['lightning', 'flicker'].includes(c.kind)) f.x.m.fx(f.lid, c.kind, Math.max(100, Math.min(10000, +c.ms || 600))).catch(e => log(`${f.x.m.name}: ${e.message}`));
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
            for (const f of x.m.settings) {
              const v = c.settings[f.key];
              next[f.key] = f.secret && (v == null || v === '') ? old[f.key] ?? '' : typeof v === 'string' ? v.trim().slice(0, 2000) : old[f.key] ?? '';
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

// a lamp without its own "identify": on bright white, off, back on
async function blink(f) {
  const s = ms => new Promise(r => setTimeout(r, ms));
  await f.x.m.set(f.lid, { color: '#ffffff', bri: 1, fade: 0 }); await s(500);
  await f.x.m.set(f.lid, 'off'); await s(500);
  await f.x.m.set(f.lid, { color: '#ffffff', bri: 1, fade: 0 });
}
