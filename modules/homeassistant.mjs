// Home Assistant: every light HA knows (Zigbee, Wi-Fi, Hue, IKEA… whatever is set up there), over HA's REST API.
// Needs the HA address and a long-lived access token (HA → your profile → Security → Long-lived access tokens).
import { hexToRgb, request } from '../lib/util.mjs';

const COLOR_MODES = new Set(['hs', 'rgb', 'rgbw', 'rgbww', 'xy']);

export default {
  id: 'homeassistant', name: 'Home Assistant', rate: 10,
  settings: [
    { key: 'url', label: 'Адрес Home Assistant', placeholder: 'http://homeassistant.local:8123' },
    { key: 'token', label: 'Долгосрочный токен доступа', secret: true },
  ],
  call(path, body) {
    return request(this.base + path, { method: body ? 'POST' : 'GET', body: body && JSON.stringify(body), headers: { Authorization: 'Bearer ' + this.token, 'Content-Type': 'application/json' } });
  },
  async start({ url, token }) {
    if (!url || !token) throw new Error('нужны адрес и токен');
    this.base = url.replace(/\/+$/, ''); this.token = token;
    await this.call('/api/');
  },
  async discover() {
    const all = await this.call('/api/states');
    const lamps = all.filter(s => s.entity_id.startsWith('light.')).map(s => ({
      id: s.entity_id, name: s.attributes?.friendly_name || s.entity_id,
      caps: { color: (s.attributes?.supported_color_modes || []).some(m => COLOR_MODES.has(m)), fast: true },
    }));
    this.caps = new Map(lamps.map(l => [l.id, l.caps.color])); // a white-only lamp gets brightness, not a color
    return lamps;
  },
  async set(id, t) {
    if (t === 'off' || t.bri <= 0) return this.call('/api/services/light/turn_off', { entity_id: id });
    const body = { entity_id: id };
    if (this.lampColor(id)) body.rgb_color = hexToRgb(t.color);
    Object.assign(body, { brightness_pct: Math.max(1, Math.round(t.bri * 100)), transition: t.fade });
    return this.call('/api/services/light/turn_on', body);
  },
  lampColor(id) { return this.caps?.get(id) ?? true; },
  async stop() { },
};
