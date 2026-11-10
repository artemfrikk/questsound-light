#!/usr/bin/env node
// QuestSound Light — the bridge between questsound.ru and your smart lights.
// It connects out to the QuestSound server (no open ports needed), takes light commands from your own
// QuestSound tab and drives your lamps through the modules in ./modules. Settings and tokens stay in
// ~/.questsound-light.json on this computer. See README.md and SECURITY.md.
import { loadConfig, saveConfig, CONFIG_PATH } from './lib/config.mjs';
import { connect, pair, newKey, newCode } from './lib/link.mjs';
import { makeHub } from './lib/hub.mjs';
import { MODULES } from './modules/index.mjs';

const VERSION = '0.1.1';
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
let link = null;
const hub = makeHub({ modules: MODULES, config: cfg, save, publish: s => link?.sendState(s), log });

// The code is shown at every start (a browser that forgot the bridge links again with it) and renewed
// every 9 minutes (it lives 10 on the server) until a QuestSound tab talks to the bridge.
let codeTimer = null, siteSeen = false;
async function showCode(quiet = false) {
  clearTimeout(codeTimer);
  const code = newCode();
  try {
    await pair(cfg.server, cfg.key, code);
    if (!quiet) console.log(`
  Код привязки / pairing code:

      ${code}

  questsound.ru → Освещение → введите код → «Подключить»
`);
    else log(`новый код привязки / new pairing code: ${code}`);
  } catch (e) { log(`не удалось получить код / no pairing code: ${e.message}`); }
  if (!siteSeen) codeTimer = setTimeout(() => showCode(true), 9 * 60e3);
}

function startLink() {
  link?.close();
  link = connect({
    server: cfg.server, key: cfg.key,
    onOnline: on => { log(on ? 'на связи с сервером / connected' : 'нет связи, повторяю… / reconnecting…'); if (on) hub.handle({ cmd: 'hello' }); },
    onReplaced: () => log('!!! ключ моста занят другой копией (другой компьютер или кто-то с вашим ключом). Повторю через минуту. Если это не вы, запустите мост с --pair / another copy took this bridge key; retrying in a minute. If that was not you, re-pair with --pair'),
    onCmd: c => {
      if (!siteSeen) { siteSeen = true; clearTimeout(codeTimer); log('сайт подключён / site linked'); }
      if (!cfg.paired) { cfg.paired = true; save(); }
      if (c.cmd === 'unpair') return unpair();
      hub.handle(c).catch(e => log(e.message));
    },
  });
}
// The site unlinked: this key is dead. Make a new one and show a new code right away; module settings stay.
function unpair() {
  cfg.key = newKey(); cfg.paired = false; siteSeen = false; save();
  log('привязка удалена, вот новый код / unlinked, here is a new code');
  startLink();
  showCode();
}

startLink();
showCode();
await hub.start();
for (const m of hub.state().modules) if (m.configured) log(`${m.name}: ${m.ok ? 'ok' : m.error}`);

async function quit(code) { clearTimeout(codeTimer); link?.close(); await hub.stop(); process.exit(code); }
process.on('SIGINT', () => quit(0));
process.on('SIGTERM', () => quit(0));
