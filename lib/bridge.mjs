// The bridge itself, shared by the console (questsound-light.mjs) and the desktop window (app/main.mjs):
// the line to the server, the pairing code, the hub with its modules. Whoever runs it watches status().
import fs from 'node:fs';
import { loadConfig, saveConfig } from './config.mjs';
import { connect, pair, newKey, newCode } from './link.mjs';
import { makeHub } from './hub.mjs';
import { MODULES } from '../modules/index.mjs';

export const VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

// server: override the saved one; repair: forget the old link; log(msg); onChange(status) after anything changes
export async function startBridge({ server, repair = false, log = () => { }, onChange = () => { }, configFile } = {}) {
  const cfg = configFile ? loadConfig(configFile) : loadConfig();
  const save = () => configFile ? saveConfig(cfg, configFile) : saveConfig(cfg);
  if (server) cfg.server = server.replace(/\/+$/, '');
  if (!cfg.key || repair) { cfg.key = newKey(); cfg.paired = false; }
  save();

  const st = { online: false, code: null, codeError: null, siteSeen: false, replaced: false };
  let link = null, codeTimer = null, stopped = false;
  const changed = () => { if (!stopped) onChange(status()); };
  const hub = makeHub({ modules: MODULES, config: cfg, save, publish: s => { link?.sendState(s); changed(); }, log });

  function status() {
    const s = hub.state();
    return {
      version: VERSION, server: cfg.server, online: st.online, replaced: st.replaced,
      // linked: a site has this key; code: one to type on the site (for a first link or another browser)
      linked: st.siteSeen || cfg.paired, code: st.code, codeError: st.codeError,
      modules: s.modules.filter(m => m.configured).map(m => ({ id: m.id, name: m.name, ok: m.ok, error: m.error,
        lamps: s.lamps.filter(l => l.module === m.id).length, failing: s.lamps.filter(l => l.module === m.id && !l.ok).length })),
    };
  }

  // the code lives 10 minutes on the server: renewed every 9 until a site talks to the bridge
  async function newPairCode() {
    clearTimeout(codeTimer);
    const code = newCode();
    try { await pair(cfg.server, cfg.key, code); st.code = code; st.codeError = null; log(`код привязки / pairing code: ${code}`); }
    catch (e) { st.code = null; st.codeError = e.message; log(`не удалось получить код / no pairing code: ${e.message}`); }
    if (stopped) return;
    // not linked yet (or no code): keep a live code; linked already: an extra code just runs out
    if (!st.siteSeen || !st.code) codeTimer = setTimeout(newPairCode, st.code ? 9 * 60e3 : 15e3);
    else codeTimer = setTimeout(() => { st.code = null; changed(); }, 9 * 60e3);
    changed();
  }

  function startLink() {
    link?.close();
    link = connect({
      server: cfg.server, key: cfg.key,
      onOnline: on => {
        st.online = on; if (on) st.replaced = false;
        log(on ? 'на связи с сервером / connected' : 'нет связи, повторяю… / reconnecting…');
        if (on) hub.handle({ cmd: 'hello' });
        changed();
      },
      onReplaced: () => { st.replaced = true; log('ключ моста занят другой копией, повторю через минуту / another copy took this key, retrying in a minute'); changed(); },
      onCmd: c => {
        if (!st.siteSeen) { st.siteSeen = true; clearTimeout(codeTimer); if (!cfg.paired) st.code = null; log('сайт подключён / site linked'); changed(); }
        if (!cfg.paired) { cfg.paired = true; save(); }
        if (c.cmd === 'unpair') return unpair();
        hub.handle(c).catch(e => log(e.message));
      },
    });
  }

  // forget the site: a new key and a new code at once; the lamps' settings stay
  function unpair() {
    cfg.key = newKey(); cfg.paired = false; st.siteSeen = false; st.code = null; save();
    log('привязка удалена, новый код / unlinked, new code');
    startLink(); newPairCode();
  }

  startLink();
  // a bridge that was linked before keeps its link; one that never was shows a code (a code is also
  // made when the site forgot the key: that site gets its state only after typing the new code)
  if (!cfg.paired) newPairCode();
  await hub.start();
  for (const m of hub.state().modules) if (m.configured) log(`${m.name}: ${m.ok ? 'ok' : m.error}`);
  changed();

  return {
    status, unpair,
    newCode: newPairCode, // "link another browser": a fresh code without dropping the current link
    async stop() { stopped = true; clearTimeout(codeTimer); link?.close(); await hub.stop(); },
  };
}
