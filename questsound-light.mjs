#!/usr/bin/env node
// QuestSound Light — the bridge between questsound.ru and your smart lights, console version
// (for a Raspberry Pi or a server; the desktop window is app/main.mjs). It connects out to the QuestSound
// server (no open ports needed), takes light commands from your own QuestSound tab and drives your lamps
// through the modules in ./modules. Settings and tokens stay in ~/.questsound-light.json. See README.md and SECURITY.md.
import { CONFIG_PATH } from './lib/config.mjs';
import { startBridge, VERSION } from './lib/bridge.mjs';

const args = process.argv.slice(2), arg = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
if (args.includes('--help') || args.includes('-h')) {
  console.log(`questsound-light ${VERSION}
  --pair            forget the old link and show a new code / новый код привязки
  --server <url>    QuestSound server (default https://questsound.ru)
  config file: ${CONFIG_PATH} (QSL_CONFIG to change)`);
  process.exit(0);
}
const log = msg => console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);

// the code is printed big, on its own line, so it can be copied at once
let shown = null;
const bridge = await startBridge({
  server: arg('--server'), repair: args.includes('--pair'), log,
  onChange: s => {
    if (s.code && s.code !== shown) console.log(`\n  Код привязки / pairing code:\n\n      ${s.code}\n\n  questsound.ru → Освещение → введите код → «Подключить»\n`);
    shown = s.code;
  },
});
console.log(`QuestSound Light ${VERSION} → ${bridge.status().server}`);
// a browser that forgot the bridge links again with a code: the console shows one at every start
if (bridge.status().linked) bridge.newCode();

async function quit(code) { await bridge.stop(); process.exit(code); }
process.on('SIGINT', () => quit(0));
process.on('SIGTERM', () => quit(0));
