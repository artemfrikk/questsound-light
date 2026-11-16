import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startQS, post, until, SERVER_DIR } from './helpers.mjs';
import { startBridge } from '../lib/bridge.mjs';

const skip = !SERVER_DIR && 'set QS_SERVER_DIR to the QuestSound folder';
const tmpCfg = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qsl-')), 'c.json');

test('bridge: a new one shows a code; the site claims it, links, unlinks and gets a new code', { skip, timeout: 20000 }, async t => {
  const S = await startQS(); t.after(() => S.stop());
  const seen = [];
  const b = await startBridge({ server: S.url, configFile: tmpCfg(), onChange: s => seen.push(s) }); t.after(() => b.stop());
  await until(() => b.status().online && b.status().code);
  const s0 = b.status();
  assert.equal(s0.linked, false); assert.match(s0.code, /^[A-Z2-9]{6}$/);
  const key = (await post(`${S.url}/api/light/claim`, { code: s0.code })).json.key;
  await post(`${S.url}/api/light/${key}/cmd`, { cmd: 'hello' });
  await until(() => b.status().linked);
  assert.equal(b.status().code, null); // the code is used up
  await post(`${S.url}/api/light/${key}/cmd`, { cmd: 'unpair' });
  await until(() => !b.status().linked && b.status().code && b.status().code !== s0.code);
  assert.ok(seen.length > 2);
});
test('bridge: a linked one starts without a code and can make one for another browser', { skip, timeout: 20000 }, async t => {
  const S = await startQS(); t.after(() => S.stop());
  const file = tmpCfg();
  fs.writeFileSync(file, JSON.stringify({ server: S.url, key: 'a'.repeat(32), paired: true, modules: {} }));
  const b = await startBridge({ configFile: file }); t.after(() => b.stop());
  await until(() => b.status().online);
  assert.equal(b.status().linked, true); assert.equal(b.status().code, null);
  await b.newCode();
  assert.match(b.status().code, /^[A-Z2-9]{6}$/); assert.equal(b.status().linked, true);
});
