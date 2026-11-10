import test from 'node:test';
import assert from 'node:assert/strict';
import { makeAnimator } from '../lib/anim.mjs';

// a clock the test moves by hand; ticks are called directly
function rig(over = {}) {
  let t = 1000; const out = [];
  const a = makeAnimator({ push: (id, v) => out.push([id, v]), rate: 2, nativeFade: false, now: () => t, rand: () => 0.5, timers: false, ...over });
  return { a, out, at: ms => { t = 1000 + ms; a.tick(); } };
}

test('a lamp that cannot fade gets a fade in steps, ending exactly on the target', () => {
  const { a, out, at } = rig();
  a.set('l', { color: '#ff0000', bri: 1, fade: 2 }, { color: '#0000ff', bri: 0.2 });
  at(0); at(1000); at(2000);
  assert.equal(out.length, 3);
  assert.deepEqual(out[0][1], { color: '#0000ff', bri: 0.2, fade: 0.5 });
  assert.equal(out[1][1].color, '#800080'); assert.equal(out[1][1].bri, 0.6); // halfway
  assert.deepEqual(out[2][1], { color: '#ff0000', bri: 1, fade: 0.5 });
  assert.equal(a.active('l'), false); at(3000); assert.equal(out.length, 3); // done: nothing more is sent
});
test('no fade, or a lamp that fades itself: one push, nothing animated', () => {
  const r1 = rig(); r1.a.set('l', { color: '#ff0000', bri: 1, fade: 0 }, null);
  assert.deepEqual(r1.out, [['l', { color: '#ff0000', bri: 1, fade: 0 }]]);
  const r2 = rig({ nativeFade: true }); r2.a.set('l', { color: '#ff0000', bri: 1, fade: 2 }, null);
  assert.equal(r2.out.length, 1); assert.equal(r2.a.active('l'), false);
});
test('off dims out first, then turns off', () => {
  const { a, out, at } = rig();
  a.set('l', 'off', { color: '#ffffff', bri: 0.8 });
  at(750); at(1600);
  assert.ok(out[0][1].bri > 0 && out[0][1].bri < 0.8);
  assert.deepEqual(out.at(-1), ['l', 'off']);
});
test('breath loops until another value comes', () => {
  const { a, out, at } = rig();
  a.set('l', { color: '#ffaa00', bri: 1, fade: 0, fx: 'breath' }, { color: '#ffaa00', bri: 1 });
  at(0); at(3000); at(6000);
  assert.equal(out[0][1].bri, 1); assert.equal(out[1][1].bri, 0.35); assert.equal(out[2][1].bri, 1); // a 6 s breath
  assert.ok(a.active('l'));
  a.set('l', { color: '#ffaa00', bri: 1, fade: 0 }, null);
  assert.equal(a.active('l'), false);
});
test('fire flickers warm and dim around the color; a busy lamp is skipped', () => {
  let busy = false;
  const { a, out, at } = rig({ busy: () => busy });
  a.set('l', { color: '#ffffff', bri: 1, fade: 0, fx: 'fire' }, null);
  at(0);
  assert.equal(out[0][1].bri, 0.775);
  assert.notEqual(out[0][1].color, '#ffffff');
  busy = true; at(500); assert.equal(out.length, 1);
});
test('a lamp that fades itself runs the effect only after its own fade', () => {
  const { a, out, at } = rig({ nativeFade: true });
  a.set('l', { color: '#ff0000', bri: 1, fade: 2, fx: 'breath' }, null);
  assert.deepEqual(out, [['l', { color: '#ff0000', bri: 1, fade: 2 }]]);
  at(1000); assert.equal(out.length, 1);
  at(2000); assert.equal(out.length, 2);
});
