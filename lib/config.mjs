// The bridge's settings file: which server, the key it shares with the site, and each module's settings
// (addresses, tokens). It lives only on this computer, readable by its owner alone; nothing in it is sent back to the site.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CONFIG_PATH = process.env.QSL_CONFIG || path.join(os.homedir(), '.questsound-light.json');
const DEFAULTS = () => ({ server: 'https://questsound.ru', key: null, paired: false, modules: {} });

export function loadConfig(file = CONFIG_PATH) {
  try { return { ...DEFAULTS(), ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { return DEFAULTS(); }
}

export function saveConfig(cfg, file = CONFIG_PATH) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
  try { fs.chmodSync(file, 0o600); } catch { }
}
