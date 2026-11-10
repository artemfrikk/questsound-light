#!/usr/bin/env node
// QuestSound Light — the bridge between questsound.ru and your smart lights.
// It connects out to the QuestSound server (no open ports needed), takes light commands from your own
// QuestSound tab and drives your lamps through the modules in ./modules. Settings and tokens stay in
// ~/.questsound-light.json on this computer. See README.md and SECURITY.md.
import { loadConfig, saveConfig, CONFIG_PATH } from './lib/config.mjs';
import { connect, pair, newKey, newCode } from './lib/link.mjs';
import { makeHub } from './lib/hub.mjs';
import { MODULES } from './modules/index.mjs';

const VERSION = '0.1.0';
const args = process.argv.slice(2), arg = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
if (args.includes('--help') || args.includes('-h')) {
  console.log(`questsound-light ${VERSION}
  --pair            forget the old link and show a new code / новый код привязки
  --server <url>    QuestSound server (default https://questsound.ru)
  config file: ${CONFIG_PATH} (QSL_CONFIG to change)`);
  process.exit(0);
}
const time = () => new Date().toLocaleTimeString();
const log = msg => console.log(`[${time()}] ${msg}`);

const cfg = loadConfig();
const save = () => saveConfig(cfg);
if (arg('--server')) cfg.server = arg('--server').replace(/\/+$/, '');
if (!cfg.key || args.includes('--pair')) { cfg.key = newKey(); cfg.paired = false; }
save();

console.log(`QuestSound Light ${VERSION} → ${cfg.server}`);
const hub = makeHub({ modules: MODULES, config: cfg, save, publish: s => link.sendState(s), log });

let codeTimer = null;
async function showCode() {
  const code = newCode();
  try {
    await pair(cfg.server, cfg.key, code);
    console.log(`
  ┌──────────────────────────────────────────────┐
  │  Код привязки / pairing code:   ${code.split('').join(' ')}  │
  │  questsound.ru → Освещение → «Подключить»     │
  └──────────────────────────────────────────────┘`);
  } catch (e) { log(`не удалось получить код / no pairing code: ${e.message}`); }
  codeTimer = setTimeout(showCode, 9 * 60e3); // a code lives 10 minutes on the server
}

const link = connect({
  server: cfg.server, key: cfg.key,
  onOnline: on => { log(on ? 'на связи с сервером / connected' : 'нет связи, повторяю… / reconnecting…'); if (on) hub.handle({ cmd: 'hello' }); },
  onReplaced: () => log('!!! ключ моста занят другой копией (другой компьютер или кто-то с вашим ключом). Повторю через минуту. Если это не вы, запустите мост с --pair / another copy took this bridge key; retrying in a minute. If that was not you, re-pair with --pair'),
  onCmd: c => {
    if (!cfg.paired) { cfg.paired = true; save(); clearTimeout(codeTimer); log('сайт подключён / site linked'); }
    if (c.cmd === 'unpair') { cfg.key = null; cfg.paired = false; save(); log('привязка удалена / unlinked'); return quit(0); }
    hub.handle(c).catch(e => log(e.message));
  },
});
if (!cfg.paired) showCode();
await hub.start();
for (const m of hub.state().modules) if (m.configured) log(`${m.name}: ${m.ok ? 'ok' : m.error}`);

async function quit(code) { clearTimeout(codeTimer); link.close(); await hub.stop(); process.exit(code); }
process.on('SIGINT', () => quit(0));
process.on('SIGTERM', () => quit(0));
