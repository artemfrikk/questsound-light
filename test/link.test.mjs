import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startQS, post, until, SERVER_DIR } from './helpers.mjs';
import { connect, pair, newKey, newCode } from '../lib/link.mjs';
import { loadConfig, saveConfig } from '../lib/config.mjs';

const skip = !SERVER_DIR && 'set QS_SERVER_DIR to the QuestSound folder';

test('pairs and receives cmd', { skip }, async t => {
  const S = await startQS(); t.after(() => S.stop());
  const key = newKey(), code = newCode();
  await pair(S.url, key, code);
  assert.equal((await post(`${S.url}/api/light/claim`, { code })).json.key, key);
  const got = [];
  const link = connect({ server: S.url, key, onCmd: c => got.push(c) }); t.after(() => link.close());
  await until(() => link.online);
  assert.equal((await post(`${S.url}/api/light/${key}/cmd`, { cmd: 'scan' })).status, 200);
  await until(() => got.length);
  assert.deepEqual(got[0], { cmd: 'scan' });
  assert.equal(await link.sendState({ lamps: [] }), true);
});

test('reconnects after a server restart', { skip, timeout: 20000 }, async t => {
  let S = await startQS();
  const port = S.port, key = newKey();
  const link = connect({ server: S.url, key, onCmd() { }, retryMs: 500 }); t.after(() => { link.close(); S.stop(); });
  await until(() => link.online);
  S.stop();
  await until(() => !link.online);
  S = await startQS(port);
  await until(() => link.online, 10000);
});

test('replaced bridge stops and reports it', { skip }, async t => {
  const S = await startQS(); t.after(() => S.stop());
  const key = newKey(); let replaced = false;
  const a = connect({ server: S.url, key, onCmd() { }, onReplaced: () => { replaced = true; } }); t.after(() => a.close());
  await until(() => a.online);
  const b = connect({ server: S.url, key, onCmd() { } }); t.after(() => b.close());
  await until(() => replaced && b.online);
  assert.equal(a.online, false);
});

test('config round trip, private on posix', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qsl-')), 'c.json');
  assert.deepEqual(loadConfig(f), { server: 'https://questsound.ru', key: null, paired: false, modules: {} });
  saveConfig({ server: 'http://x', key: 'k', paired: true, modules: { ha: { token: 't' } } }, f);
  assert.equal(loadConfig(f).modules.ha.token, 't');
  if (process.platform !== 'win32') assert.equal(fs.statSync(f).mode & 0o777, 0o600);
});
test('codes and keys look right', () => {
  assert.match(newKey(), /^[a-f0-9]{32}$/);
  assert.match(newCode(), /^[A-HJ-NP-Z2-9]{6}$/);
});
test('a replaced bridge comes back later instead of quitting', { skip, timeout: 15000 }, async t => {
  const S = await startQS(); t.after(() => S.stop());
  const key = newKey(); let replaced = 0;
  const a = connect({ server: S.url, key, onCmd() { }, onReplaced: () => { replaced++; }, replacedRetryMs: 300 }); t.after(() => a.close());
  await until(() => a.online);
  const b = connect({ server: S.url, key, onCmd() { } }); t.after(() => b.close());
  await until(() => replaced === 1);
  b.close();
  await until(() => a.online, 5000);
});
