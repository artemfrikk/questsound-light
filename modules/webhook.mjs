// Web request: for anything that takes HTTP (Node-RED, your own scripts, other hubs). Each named "lamp" sends
// the same request with its values filled in: {{lamp}} {{r}} {{g}} {{b}} {{hex}} {{bri}} (0–100) {{bri255}} {{on}} {{fade}} (seconds).
import { hexToRgb, request, list } from '../lib/util.mjs';

export default {
  id: 'webhook', name: 'Веб-запрос', rate: 2,
  settings: [
    { key: 'method', label: 'Метод (GET, POST, PUT)', placeholder: 'POST' },
    { key: 'url', label: 'Адрес', placeholder: 'http://192.168.1.10:1880/light?zone={{lamp}}' },
    { key: 'body', label: 'Тело запроса', optional: true, placeholder: '{"color":"{{hex}}","brightness":{{bri}}}' },
    { key: 'lamps', label: 'Названия ламп через запятую', placeholder: 'Стол, Полка' },
  ],
  async start(s) {
    if (!/^https?:\/\//.test(s.url || '')) throw new Error('адрес должен начинаться с http:// или https://');
    this.s = { method: (s.method || 'POST').toUpperCase(), url: s.url, body: s.body || '', lamps: list(s.lamps) };
  },
  async discover() { return this.s.lamps.map(n => ({ id: n, name: n, caps: { color: true, fast: false } })); },
  set(lamp, t) {
    const off = t === 'off' || t.bri <= 0, [r, g, b] = off ? [0, 0, 0] : hexToRgb(t.color);
    const v = { lamp, r, g, b, hex: off ? '000000' : t.color.slice(1), bri: off ? 0 : Math.round(t.bri * 100), bri255: off ? 0 : Math.round(t.bri * 255), on: !off, fade: off ? 0 : t.fade };
    const fill = (str, enc) => str.replace(/\{\{(\w+)\}\}/g, (m, k) => k in v ? (enc ? encodeURIComponent(v[k]) : String(v[k])) : m);
    const body = this.s.method === 'GET' ? undefined : fill(this.s.body, false);
    return request(fill(this.s.url, true), { method: this.s.method, body, headers: body ? { 'Content-Type': body.trim().startsWith('{') || body.trim().startsWith('[') ? 'application/json' : 'text/plain' } : {} });
  },
  async stop() { },
};
