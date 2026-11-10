import test from 'node:test';
import assert from 'node:assert/strict';
import { makeQueue } from '../lib/queue.mjs';
import { makeHub } from '../lib/hub.mjs';
import { sleep, until } from './helpers.mjs';

test('queue sends only the latest value per lamp, within the rate', async () => {
  const sent = [];
  const push = makeQueue({ rate: 4, send: async (id, v) => { sent.push([id, v]); } });
  for (let i = 0; i < 50; i++) { push('a', i); await sleep(2); }
  await sleep(400);
  assert.ok(sent.length <= 3, 'sent ' + sent.length);
  assert.deepEqual(sent.at(-1), ['a', 49]);
});
test('shared queue batches all lamps into one call', async () => {
  const calls = [];
  const push = makeQueue({ rate: 2, shared: true, sendMany: async m => { calls.push({ ...m }); } });
  push('a', 1); push('b', 2); push('a', 3);
  await sleep(50);
  push('c', 4);
  await sleep(700);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], { a: 3, b: 2 }); // same moment: one batch, newest value per lamp
  assert.deepEqual(calls[1], { c: 4 });
});
test('a failing lamp does not block others', async () => {
  const sent = [], errs = [];
  const push = makeQueue({ rate: 50, send: async (id, v) => { if (id === 'bad') throw new Error('timeout'); sent.push(id); }, onError: (id, e) => errs.push([id, e.message]) });
  push('bad', 1); push('good', 1);
  await sleep(50);
  assert.deepEqual(sent, ['good']); assert.deepEqual(errs, [['bad', 'timeout']]);
});

// a module that remembers what it was asked to do
function fakeModule(over = {}) {
  const m = {
    id: 'fake', name: 'Fake', rate: 50, calls: [], started: null,
    settings: [{ key: 'url', label: 'Address' }, { key: 'token', label: 'Token', secret: true }],
    async start(s) { m.started = s; if (s.token === 'bad') throw new Error('401 Unauthorized'); },
    async discover() { return [{ id: 'l1', name: 'Ceiling', caps: { color: true, fast: true } }, { id: 'l2', name: 'Strip', caps: { color: true } }]; },
    async set(id, t) { m.calls.push(['set', id, t]); },
    async fx(id, kind, ms, last) { m.calls.push(['fx', id, kind, ms, last]); },
    async stop() { m.calls.push(['stop']); },
    ...over,
  };
  return m;
}
function setup(cfgModules = { fake: { url: 'http://x', token: 'SECRET123' } }) {
  const mod = fakeModule(), states = [], saved = [];
  const config = { modules: cfgModules };
  const hub = makeHub({ modules: [mod], config, save: () => saved.push(JSON.parse(JSON.stringify(config))), publish: s => states.push(s) });
  return { mod, hub, states, saved, config };
}

test('starts configured modules and publishes their lamps', async () => {
  const { hub, states } = setup();
  await hub.start();
  const s = states.at(-1);
  assert.deepEqual(s.lamps.map(l => l.id), ['fake:l1', 'fake:l2']);
  assert.equal(s.modules[0].configured, true); assert.equal(s.modules[0].ok, true);
});
test('set goes to the right lamp, off too, unknown ids ignored', async () => {
  const { hub, mod } = setup(); await hub.start();
  await hub.handle({ cmd: 'set', lamps: { 'fake:l1': { color: '#ff0000', bri: 0.5, fade: 1 }, 'fake:l2': 'off', 'nope:x': 'off', 'fake:zz': 'off' } });
  await until(() => mod.calls.length >= 2);
  await sleep(30);
  assert.deepEqual(mod.calls, [['set', 'l1', { color: '#ff0000', bri: 0.5, fade: 1 }], ['set', 'l2', 'off']]);
});
test('fx only reaches fast lamps', async () => {
  const { hub, mod } = setup(); await hub.start();
  const on = { color: '#ffffff', bri: 1, fade: 0 };
  await hub.handle({ cmd: 'set', lamps: { 'fake:l1': on, 'fake:l2': on } }); await sleep(30); mod.calls.length = 0;
  await hub.handle({ cmd: 'fx', lamps: ['fake:l1', 'fake:l2'], kind: 'lightning', ms: 400 });
  await sleep(20);
  assert.deepEqual(mod.calls[0], ['fx', 'l1', 'lightning', 400, on]);
  assert.ok(!mod.calls.some(c => c[0] === 'fx' && c[1] === 'l2'));
});
test('config saves, restarts, and never shows the token', async () => {
  const { hub, mod, states, saved } = setup({});
  await hub.start();
  assert.equal(states.at(-1).modules[0].configured, false);
  await hub.handle({ cmd: 'config', module: 'fake', settings: { url: 'http://ha', token: 'TOPSECRET' } });
  assert.equal(saved.at(-1).modules.fake.token, 'TOPSECRET');
  assert.equal(mod.started.token, 'TOPSECRET');
  const s = states.at(-1);
  assert.equal(s.modules[0].configured, true);
  assert.ok(!JSON.stringify(states).includes('TOPSECRET'));
  assert.deepEqual(s.modules[0].values, { url: 'http://ha', token: true }); // a saved secret shows only that it is there
  // an empty secret field keeps the saved one while the address stays the same
  await hub.handle({ cmd: 'config', module: 'fake', settings: { url: 'http://ha', token: '' } });
  assert.equal(saved.at(-1).modules.fake.token, 'TOPSECRET');
});
test('a module that fails to start shows its error and others go on', async () => {
  const { hub, states } = setup({ fake: { token: 'bad' } });
  await hub.start();
  const m = states.at(-1).modules[0];
  assert.equal(m.ok, false); assert.match(m.error, /401/);
  assert.equal(states.at(-1).lamps.length, 0);
});
test('removing a module stops it', async () => {
  const { hub, mod, saved } = setup(); await hub.start();
  await hub.handle({ cmd: 'config', module: 'fake', settings: null });
  assert.equal(saved.at(-1).modules.fake, undefined);
  assert.deepEqual(mod.calls.at(-1), ['stop']);
});
test('fx without a module fx: generic steps, then back to the last value', async () => {
  const mod = fakeModule({ fx: undefined }), states = [];
  const hub = makeHub({ modules: [mod], config: { modules: { fake: {} } }, save() { }, publish: s => states.push(s) });
  await hub.start();
  await hub.handle({ cmd: 'set', lamps: { 'fake:l1': { color: '#203040', bri: 0.5, fade: 1 } } });
  await sleep(30); mod.calls.length = 0;
  await hub.handle({ cmd: 'fx', lamps: ['fake:l1'], kind: 'lightning', ms: 300 });
  await sleep(600);
  assert.deepEqual(mod.calls[0], ['set', 'l1', { color: '#ffffff', bri: 1, fade: 0 }]);
  assert.deepEqual(mod.calls.at(-1), ['set', 'l1', { color: '#203040', bri: 0.5, fade: 0.3 }]);
});
test('changing the address drops saved secrets (no token sent to a new host)', async () => {
  const { hub, saved, mod } = setup();
  await hub.start();
  await hub.handle({ cmd: 'config', module: 'fake', settings: { url: 'https://evil.example', token: '' } });
  assert.equal(saved.at(-1).modules.fake.token, '');
  assert.notEqual(mod.started.token, 'SECRET123');
  await hub.handle({ cmd: 'config', module: 'fake', settings: { url: 'https://evil.example', token: 'NEW' } });
  await hub.handle({ cmd: 'config', module: 'fake', settings: { url: 'https://evil.example', token: '' } }); // same address: kept
  assert.equal(saved.at(-1).modules.fake.token, 'NEW');
});
test('a shared module can fail some lamps only', async () => {
  const mod = fakeModule({ setMany: async b => { const e = new Error('device unreachable'); e.perId = { l2: 'DEVICE_UNREACHABLE' }; throw e; } });
  delete mod.set; const states = [];
  const hub = makeHub({ modules: [mod], config: { modules: { fake: {} } }, save() { }, publish: s => states.push(s) });
  await hub.start();
  await hub.handle({ cmd: 'set', lamps: { 'fake:l1': 'off', 'fake:l2': 'off' } });
  await sleep(150);
  const lamps = hub.state().lamps;
  assert.equal(lamps.find(l => l.id === 'fake:l1').ok, true);
  assert.equal(lamps.find(l => l.id === 'fake:l2').error, 'DEVICE_UNREACHABLE');
});
test('two fast saves run one after another', async () => {
  const order = [];
  const mod = fakeModule({ async start(s) { order.push('start ' + s.url); await sleep(30); order.push('ready ' + s.url); }, async stop() { order.push('stop'); } });
  const hub = makeHub({ modules: [mod], config: { modules: {} }, save() { }, publish() { } });
  await hub.start();
  await Promise.all([hub.handle({ cmd: 'config', module: 'fake', settings: { url: 'a' } }), hub.handle({ cmd: 'config', module: 'fake', settings: { url: 'b' } })]);
  assert.deepEqual(order, ['start a', 'ready a', 'stop', 'start b', 'ready b']);
});
test('effects skip lamps that are off or never set', async () => {
  const mod = fakeModule({ fx: undefined });
  const hub = makeHub({ modules: [mod], config: { modules: { fake: {} } }, save() { }, publish() { } });
  await hub.start();
  await hub.handle({ cmd: 'set', lamps: { 'fake:l1': 'off' } }); await sleep(30); mod.calls.length = 0;
  await hub.handle({ cmd: 'fx', lamps: ['fake:l1', 'fake:l2'], kind: 'flicker', ms: 300 }); await sleep(400);
  assert.deepEqual(mod.calls, []);
});
test('credentials inside plain fields are masked in state and survive a re-save', async () => {
  const mod = fakeModule({ settings: [{ key: 'url', label: 'URL' }] }), saved = [];
  const config = { modules: {} };
  const hub = makeHub({ modules: [mod], config, save: () => saved.push(JSON.parse(JSON.stringify(config))), publish() { } });
  await hub.start();
  const url = 'http://bob:pw1@nodered:1880/l?token=SEKRET&zone=1';
  await hub.handle({ cmd: 'config', module: 'fake', settings: { url } });
  const shown = hub.state().modules[0].values.url;
  assert.ok(!shown.includes('pw1') && !shown.includes('SEKRET'), shown);
  assert.match(shown, /zone=1/);
  await hub.handle({ cmd: 'config', module: 'fake', settings: { url: shown } }); // the form sends back what it showed
  assert.equal(saved.at(-1).modules.fake.url, url);
});
