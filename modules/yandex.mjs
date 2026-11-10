// Yandex smart home ("Дом с Алисой"): lamps linked to your Yandex account, through the official Smart Home API.
// Needs an OAuth token with iot:view and iot:control (README → Yandex). Goes through Yandex's cloud, so a change
// takes about a second and the module sends at most two calls a second, all lamps in one call.
import { hexToRgb, request } from '../lib/util.mjs';

const BASE = () => process.env.QSL_YANDEX_URL || 'https://api.iot.yandex.net';
const CAP = 'devices.capabilities.';

export default {
  id: 'yandex', name: 'Яндекс', rate: 2,
  settings: [{ key: 'token', label: 'OAuth-токен Яндекса', secret: true }],
  call(path, body) {
    return request(BASE() + path, { method: body ? 'POST' : 'GET', body: body && JSON.stringify(body), headers: { Authorization: 'Bearer ' + this.token, 'Content-Type': 'application/json' }, timeout: 8000 });
  },
  async start({ token }) {
    if (!token) throw new Error('нужен токен');
    this.token = token; this.info = await this.call('/v1.0/user/info');
  },
  async discover() {
    this.info = await this.call('/v1.0/user/info');
    this.models = new Map();
    return (this.info.devices || []).filter(d => d.type?.startsWith('devices.types.light')).map(d => {
      const cs = d.capabilities?.find(c => c.type === CAP + 'color_setting'), model = cs?.parameters?.color_model || null;
      this.models.set(d.id, model);
      return { id: d.id, name: d.name, caps: { color: !!model, fast: false } };
    });
  },
  setMany(batch) {
    const devices = Object.entries(batch).map(([id, t]) => {
      if (t === 'off' || t.bri <= 0) return { id, actions: [{ type: CAP + 'on_off', state: { instance: 'on', value: false } }] };
      const actions = [{ type: CAP + 'on_off', state: { instance: 'on', value: true } }], model = this.models?.get(id);
      const [r, g, b] = hexToRgb(t.color);
      if (model === 'rgb') actions.push({ type: CAP + 'color_setting', state: { instance: 'rgb', value: (r << 16) + (g << 8) + b } });
      else if (model === 'hsv') actions.push({ type: CAP + 'color_setting', state: { instance: 'hsv', value: rgbToHsv(r, g, b) } });
      actions.push({ type: CAP + 'range', state: { instance: 'brightness', value: Math.max(1, Math.round(t.bri * 100)) } });
      return { id, actions };
    });
    return this.call('/v1.0/devices/actions', { devices });
  },
  set(id, t) { return this.setMany({ [id]: t }); },
  async stop() { },
};

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: Math.round((h * 60 + 360) % 360), s: Math.round(max ? d / max * 100 : 0), v: Math.round(max * 100) };
}
