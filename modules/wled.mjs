// WLED: LED strips and lamps running WLED firmware, over its local JSON API. List the addresses (IP or name).
import { hexToRgb, request, list } from '../lib/util.mjs';

export default {
  id: 'wled', name: 'WLED', rate: 20,
  settings: [{ key: 'hosts', label: 'Адреса WLED через запятую', placeholder: '192.168.1.50, wled-strip.local' }],
  async start({ hosts }) {
    this.hosts = list(hosts);
    if (!this.hosts.length) throw new Error('укажите хотя бы один адрес');
  },
  async discover() {
    const out = [];
    for (const h of this.hosts) {
      try { const info = await request(`http://${h}/json/info`, { timeout: 3000 }); out.push({ id: h, name: info.name || h, caps: { color: true, fast: true } }); } catch { }
    }
    return out;
  },
  set(host, t) {
    const body = t === 'off' || t.bri <= 0 ? { on: false }
      : { on: true, bri: Math.max(1, Math.round(t.bri * 255)), transition: Math.round(t.fade * 10), seg: [{ col: [hexToRgb(t.color)] }] };
    return request(`http://${host}/json/state`, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
  },
  async stop() { },
};
