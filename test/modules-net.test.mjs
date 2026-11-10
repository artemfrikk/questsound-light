import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { stub } from './stub.mjs';
import { sleep, until } from './helpers.mjs';
import { makeQueue } from '../lib/queue.mjs';

const fresh = async name => ({ ...(await import(`../modules/${name}.mjs?${Math.random()}`)).default });

// a Yeelight bulb: JSON lines over TCP, answers {"id":n,"result":["ok"]}
async function fakeBulb() {
  const got = [];
  const srv = net.createServer(sock => {
    let buf = '';
    sock.on('data', d => {
      buf += d;
      for (let i; (i = buf.indexOf('\r\n')) >= 0; buf = buf.slice(i + 2)) {
        const msg = JSON.parse(buf.slice(0, i)); got.push(msg);
        sock.write(JSON.stringify({ id: msg.id, result: ['ok'] }) + '\r\n');
      }
    });
  });
  await new Promise(ok => srv.listen(0, '127.0.0.1', ok));
  return { host: `127.0.0.1:${srv.address().port}`, got, close: () => srv.close() };
}

test('Yeelight: one smooth command per change, off, fx', async t => {
  process.env.QSL_NO_SSDP = '1';
  const B = await fakeBulb(); t.after(B.close);
  const m = await fresh('yeelight'); t.after(() => m.stop());
  await m.start({ hosts: B.host });
  const lamps = await m.discover();
  assert.deepEqual(lamps, [{ id: B.host, name: 'Yeelight ' + B.host, caps: { color: true, fast: true } }]);
  await m.set(B.host, { color: '#ff0000', bri: 0.5, fade: 1.5 });
  await m.set(B.host, 'off');
  await m.fx(B.host, 'lightning', 400);
  assert.deepEqual(B.got.map(x => [x.method, x.params]), [
    ['set_scene', ['cf', 1, 1, '1500,1,16711680,50']],
    ['set_power', ['off', 'smooth', 500]],
    ['start_cf', [3, 0, '100,1,16777215,100,150,7,0,0,100,1,16777215,100']],
  ]);
});
test('Yeelight: an error answer becomes an error', async t => {
  process.env.QSL_NO_SSDP = '1';
  const srv = net.createServer(s => s.on('data', d => { const id = JSON.parse(String(d)).id; s.write(JSON.stringify({ id, error: { code: -1, message: 'client quota exceeded' } }) + '\r\n'); }));
  await new Promise(ok => srv.listen(0, '127.0.0.1', ok)); t.after(() => srv.close());
  const host = `127.0.0.1:${srv.address().port}`;
  const m = await fresh('yeelight'); t.after(() => m.stop());
  await m.start({ hosts: host }); await m.discover();
  await assert.rejects(m.set(host, 'off'), /quota/);
});

test('Yandex: lights, rgb and hsv lamps, one actions call', async t => {
  const S = await stub({
    'GET /v1.0/user/info': [200, { status: 'ok', devices: [
      { id: 'd1', name: 'Люстра', type: 'devices.types.light', capabilities: [{ type: 'devices.capabilities.on_off' }, { type: 'devices.capabilities.color_setting', parameters: { color_model: 'rgb' } }, { type: 'devices.capabilities.range', parameters: { instance: 'brightness' } }] },
      { id: 'd2', name: 'Ночник', type: 'devices.types.light.lamp', capabilities: [{ type: 'devices.capabilities.color_setting', parameters: { color_model: 'hsv' } }] },
      { id: 'd3', name: 'Чайник', type: 'devices.types.cooking.kettle', capabilities: [] },
    ] }],
    'POST /v1.0/devices/actions': [200, { status: 'ok' }],
  }); t.after(S.close);
  process.env.QSL_YANDEX_URL = S.url;
  const m = await fresh('yandex');
  await m.start({ token: 'YT' });
  assert.deepEqual(await m.discover(), [
    { id: 'd1', name: 'Люстра', caps: { color: true, fast: false } },
    { id: 'd2', name: 'Ночник', caps: { color: true, fast: false } },
  ]);
  await m.setMany({ d1: { color: '#ff0000', bri: 0.5, fade: 1 }, d2: 'off' });
  const body = S.seen.find(r => r.method === 'POST').json;
  assert.deepEqual(body, { devices: [
    { id: 'd1', actions: [
      { type: 'devices.capabilities.on_off', state: { instance: 'on', value: true } },
      { type: 'devices.capabilities.color_setting', state: { instance: 'rgb', value: 16711680 } },
      { type: 'devices.capabilities.range', state: { instance: 'brightness', value: 50 } }] },
    { id: 'd2', actions: [{ type: 'devices.capabilities.on_off', state: { instance: 'on', value: false } }] },
  ] });
  assert.ok(S.seen.every(r => r.headers.authorization === 'Bearer YT'));
  await m.setMany({ d2: { color: '#00ff00', bri: 1, fade: 0 } });
  const hsv = S.seen.filter(r => r.method === 'POST')[1].json.devices[0].actions[1];
  assert.deepEqual(hsv, { type: 'devices.capabilities.color_setting', state: { instance: 'hsv', value: { h: 120, s: 100, v: 100 } } });
});
test('Yandex: 2 calls a second across all lamps', async () => {
  const calls = [];
  const push = makeQueue({ rate: 2, shared: true, sendMany: async b => { calls.push(Date.now()); } });
  for (let i = 0; i < 20; i++) { push('d' + (i % 5), i); await sleep(50); }
  await sleep(600);
  for (let i = 1; i < calls.length; i++) assert.ok(calls[i] - calls[i - 1] >= 480, 'gap ' + (calls[i] - calls[i - 1]));
});

// an MQTT broker that understands CONNECT and PUBLISH
async function fakeBroker() {
  const got = { connect: null, publish: [] };
  const srv = net.createServer(sock => {
    let buf = Buffer.alloc(0);
    sock.on('data', d => {
      buf = Buffer.concat([buf, d]);
      for (;;) {
        if (buf.length < 2) return;
        let len = 0, mul = 1, i = 1, b;
        do { b = buf[i++]; len += (b & 127) * mul; mul *= 128; } while (b & 128);
        if (buf.length < i + len) return;
        const type = buf[0] >> 4, body = buf.subarray(i, i + len); buf = buf.subarray(i + len);
        const str = (o) => { const n = body.readUInt16BE(o); return [body.subarray(o + 2, o + 2 + n).toString(), o + 2 + n]; };
        if (type === 1) {
          const [proto, o] = str(0), flags = body[o + 1];
          let [client, p] = str(o + 4), user = null, pass = null;
          if (flags & 0x80) [user, p] = str(p);
          if (flags & 0x40) [pass, p] = str(p);
          got.connect = { proto, level: body[o], client, user, pass };
          sock.write(Buffer.from([0x20, 2, 0, user === 'bad' ? 5 : 0]));
        } else if (type === 3) { const [topic, o] = str(0); got.publish.push([topic, JSON.parse(body.subarray(o).toString())]); }
      }
    });
  });
  await new Promise(ok => srv.listen(0, '127.0.0.1', ok));
  return { port: srv.address().port, got, close: () => srv.close() };
}
test('MQTT: connect with login, Zigbee2MQTT payloads', async t => {
  const B = await fakeBroker(); t.after(B.close);
  const m = await fresh('mqtt'); t.after(() => m.stop());
  await m.start({ host: '127.0.0.1', port: String(B.port), user: 'u', pass: 'p', lamps: 'Потолок=zigbee2mqtt/Потолок\nЛента=zigbee2mqtt/strip/set' });
  assert.deepEqual({ ...B.got.connect, client: B.got.connect.client.startsWith('questsound-light-') }, { proto: 'MQTT', level: 4, client: true, user: 'u', pass: 'p' });
  assert.deepEqual((await m.discover()).map(l => l.id), ['Потолок', 'Лента']);
  await m.set('Потолок', { color: '#ff8000', bri: 0.5, fade: 2 });
  await m.set('Лента', 'off');
  await until(() => B.got.publish.length === 2);
  assert.deepEqual(B.got.publish, [
    ['zigbee2mqtt/Потолок/set', { state: 'ON', brightness: 127, color: { r: 255, g: 128, b: 0 }, transition: 2 }],
    ['zigbee2mqtt/strip/set', { state: 'OFF' }],
  ]);
});
test('MQTT: refused login is an error', async t => {
  const B = await fakeBroker(); t.after(B.close);
  const m = await fresh('mqtt'); t.after(() => m.stop());
  await assert.rejects(m.start({ host: '127.0.0.1', port: String(B.port), user: 'bad', pass: 'x', lamps: 'a=b' }), /5/);
});
test('Yeelight: lightning runs all 3 flashes and fx lasts its time', async t => {
  process.env.QSL_NO_SSDP = '1';
  const B = await fakeBulb(); t.after(B.close);
  const m = await fresh('yeelight'); t.after(() => m.stop());
  await m.start({ hosts: B.host }); await m.discover();
  const t0 = Date.now(); await m.fx(B.host, 'lightning', 400);
  assert.ok(Date.now() - t0 >= 380, 'fx resolved too early');
  assert.equal(B.got[0].params[0], 3);
});
test('Yeelight: a broken SSDP name does not throw', async () => {
  const { parseSsdp } = await import('../modules/yeelight.mjs');
  const l = parseSsdp('HTTP/1.1 200 OK\r\nLocation: yeelight://10.0.0.5:55443\r\nid: 0x1\r\nname: %\r\nsupport: get_prop set_rgb\r\n');
  assert.equal(l.name, '%'); assert.equal(l.color, true);
});
test('Yandex: per-device ERROR results become per-lamp errors', async t => {
  const S = await stub({
    'GET /v1.0/user/info': [200, { devices: [{ id: 'd1', name: 'A', type: 'devices.types.light', capabilities: [] }, { id: 'd2', name: 'B', type: 'devices.types.light', capabilities: [] }] }],
    'POST /v1.0/devices/actions': [200, { status: 'ok', devices: [
      { id: 'd1', capabilities: [{ type: 'devices.capabilities.on_off', state: { instance: 'on', action_result: { status: 'DONE' } } }] },
      { id: 'd2', capabilities: [{ type: 'devices.capabilities.on_off', state: { instance: 'on', action_result: { status: 'ERROR', error_code: 'DEVICE_UNREACHABLE' } } }] }] }],
  }); t.after(S.close);
  process.env.QSL_YANDEX_URL = S.url;
  const m = await fresh('yandex'); await m.start({ token: 'x' }); await m.discover();
  const e = await m.setMany({ d1: 'off', d2: 'off' }).then(() => null, e => e);
  assert.ok(e); assert.deepEqual(e.perId, { d2: 'DEVICE_UNREACHABLE' });
});
