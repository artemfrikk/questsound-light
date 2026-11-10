import test from 'node:test';
import assert from 'node:assert/strict';
import { stub } from './stub.mjs';
import { hexToRgb } from '../lib/util.mjs';

const fresh = async name => ({ ...(await import(`../modules/${name}.mjs?${Math.random()}`)).default });

test('hexToRgb', () => assert.deepEqual(hexToRgb('#ff8001'), [255, 128, 1]));

test('Home Assistant: discover, set, off, bearer token', async t => {
  const S = await stub({
    'GET /api/': [200, { message: 'API running.' }],
    'GET /api/states': [200, [
      { entity_id: 'light.ceiling', attributes: { friendly_name: 'Потолок', supported_color_modes: ['xy', 'color_temp'] } },
      { entity_id: 'light.lamp', attributes: { friendly_name: 'Торшер', supported_color_modes: ['brightness'] } },
      { entity_id: 'switch.tv', attributes: {} },
    ]],
    'POST /api/services/light/turn_on': [200, []],
    'POST /api/services/light/turn_off': [200, []],
  }); t.after(S.close);
  const m = await fresh('homeassistant');
  await m.start({ url: S.url + '/', token: 'TKN' });
  const lamps = await m.discover();
  assert.deepEqual(lamps, [
    { id: 'light.ceiling', name: 'Потолок', caps: { color: true, fast: true } },
    { id: 'light.lamp', name: 'Торшер', caps: { color: false, fast: true } },
  ]);
  await m.set('light.ceiling', { color: '#ff0000', bri: 0.6, fade: 1.5 });
  await m.set('light.lamp', { color: '#ff0000', bri: 0.6, fade: 0 });
  await m.set('light.ceiling', 'off');
  const posts = S.seen.filter(r => r.method === 'POST');
  assert.deepEqual(posts.map(p => [p.url, p.json]), [
    ['/api/services/light/turn_on', { entity_id: 'light.ceiling', rgb_color: [255, 0, 0], brightness_pct: 60, transition: 1.5 }],
    ['/api/services/light/turn_on', { entity_id: 'light.lamp', brightness_pct: 60, transition: 0 }],
    ['/api/services/light/turn_off', { entity_id: 'light.ceiling' }],
  ]);
  assert.ok(S.seen.every(r => r.headers.authorization === 'Bearer TKN'));
});
test('Home Assistant: bad token is a clear error', async t => {
  const S = await stub({ 'GET /api/': [401, '401: Unauthorized'] }); t.after(S.close);
  const m = await fresh('homeassistant');
  await assert.rejects(m.start({ url: S.url, token: 'x' }), /401/);
});

test('WLED: info, color, brightness, off', async t => {
  const S = await stub({ 'GET /json/info': [200, { name: 'Лента' }], 'POST /json/state': [200, { success: true }] }); t.after(S.close);
  const m = await fresh('wled');
  await m.start({ hosts: S.host });
  assert.deepEqual(await m.discover(), [{ id: S.host, name: 'Лента', caps: { color: true, fast: true } }]);
  await m.set(S.host, { color: '#00ff80', bri: 0.5, fade: 2 });
  await m.set(S.host, 'off');
  const posts = S.seen.filter(r => r.method === 'POST').map(r => r.json);
  assert.deepEqual(posts, [{ on: true, bri: 128, transition: 20, seg: [{ col: [[0, 255, 128]] }] }, { on: false }]);
});
test('WLED: an unreachable host is skipped, not fatal', async () => {
  const m = await fresh('wled');
  await m.start({ hosts: '127.0.0.1:1' });
  assert.deepEqual(await m.discover(), []);
});

test('webhook: placeholders in url and body', async t => {
  const S = await stub({ 'POST /hook': [200, 'ok'] }); t.after(S.close);
  const m = await fresh('webhook');
  await m.start({ method: 'POST', url: S.url + '/hook?l={{lamp}}', body: '{"rgb":[{{r}},{{g}},{{b}}],"hex":"{{hex}}","bri":{{bri}},"b255":{{bri255}},"on":{{on}},"t":{{fade}}}', lamps: 'Стол, Полка' });
  assert.deepEqual((await m.discover()).map(l => l.id), ['Стол', 'Полка']);
  await m.set('Стол', { color: '#102030', bri: 0.25, fade: 1 });
  await m.set('Полка', 'off');
  assert.equal(S.seen[0].url, '/hook?l=%D0%A1%D1%82%D0%BE%D0%BB');
  assert.deepEqual(S.seen[0].json, { rgb: [16, 32, 48], hex: '102030', bri: 25, b255: 64, on: true, t: 1 });
  assert.deepEqual(S.seen[1].json, { rgb: [0, 0, 0], hex: '000000', bri: 0, b255: 0, on: false, t: 0 });
  assert.equal(S.seen[0].headers['content-type'], 'application/json');
});
