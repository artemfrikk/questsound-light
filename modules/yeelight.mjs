// Yeelight (Xiaomi) Wi-Fi bulbs and strips, over their local network protocol: the bridge finds them on the
// network by itself (SSDP) or takes the addresses you list. In the Yeelight app turn on "LAN Control" for each lamp.
// A bulb takes about 60 commands a minute, so every change is one command (set_scene "cf"), at most one a second.
import dgram from 'node:dgram';
import net from 'node:net';
import { hexToRgb, list } from '../lib/util.mjs';

const MCAST = '239.255.255.250', PORT = 1982;

export default {
  id: 'yeelight', name: 'Yeelight', rate: 1,
  settings: [{ key: 'hosts', label: 'Адреса ламп через запятую (если не находятся сами)', optional: true, placeholder: '192.168.1.40' }],
  async start({ hosts }) { this.manual = list(hosts); this.lamps = new Map(); this.conns = new Map(); this.seq = 0; },
  async discover() {
    const found = new Map();
    for (const h of this.manual) found.set(h, { id: h, name: 'Yeelight ' + h, color: true, addr: h.includes(':') ? h : h + ':55443' });
    if (!process.env.QSL_NO_SSDP) for (const l of await ssdp()) if (![...found.values()].some(x => x.addr === l.addr)) found.set(l.id, l);
    this.lamps = found;
    return [...found.values()].map(l => ({ id: l.id, name: l.name, caps: { color: l.color, fast: true } }));
  },
  // one JSON line out, the answer with the same id back (or an error)
  send(id, method, params) {
    const lamp = this.lamps.get(id);
    if (!lamp) return Promise.reject(new Error('лампа не найдена'));
    let c = this.conns.get(id);
    if (!c || c.sock.destroyed) {
      const [host, port] = lamp.addr.split(':');
      c = { sock: net.createConnection(+port || 55443, host), wait: new Map(), buf: '' };
      c.sock.setEncoding('utf8'); c.sock.setKeepAlive(true, 30000);
      c.sock.on('data', d => {
        c.buf += d;
        for (let i; (i = c.buf.indexOf('\r\n')) >= 0; c.buf = c.buf.slice(i + 2)) {
          let msg; try { msg = JSON.parse(c.buf.slice(0, i)); } catch { continue; }
          const w = c.wait.get(msg.id); if (!w) continue; // notifications ("props") have no id
          c.wait.delete(msg.id);
          msg.error ? w.fail(new Error(msg.error.message || 'error ' + msg.error.code)) : w.ok(msg.result);
        }
      });
      const drop = e => { for (const w of c.wait.values()) w.fail(new Error(e?.message || 'соединение закрыто')); c.wait.clear(); };
      c.sock.on('error', drop); c.sock.on('close', drop);
      this.conns.set(id, c);
    }
    const n = ++this.seq;
    return new Promise((ok, fail) => {
      const t = setTimeout(() => { c.wait.delete(n); fail(new Error('timeout: лампа не отвечает')); }, 4000);
      c.wait.set(n, { ok: r => { clearTimeout(t); ok(r); }, fail: e => { clearTimeout(t); fail(e); } });
      c.sock.write(JSON.stringify({ id: n, method, params }) + '\r\n');
    });
  },
  set(id, t) {
    if (t === 'off' || t.bri <= 0) return this.send(id, 'set_power', ['off', 'smooth', 500]);
    const dur = Math.max(50, Math.round(t.fade * 1000)), bri = Math.max(1, Math.round(t.bri * 100));
    const [r, g, b] = hexToRgb(t.color), step = this.lamps.get(id)?.color === false ? `${dur},2,2700,${bri}` : `${dur},1,${(r << 16) + (g << 8) + b},${bri}`;
    return this.send(id, 'set_scene', ['cf', 1, 1, step]); // turns on and fades in one command
  },
  // the bulb answers as soon as the flow starts: wait until it has played before the hub sets the lamp back
  async fx(id, kind, ms, last) {
    const wait = t => new Promise(r => setTimeout(r, t));
    if (kind === 'lightning') { await this.send(id, 'start_cf', [3, 0, '100,1,16777215,100,150,7,0,0,100,1,16777215,100']); return wait(Math.max(ms, 350)); }
    const base = last && last !== 'off' ? last : { color: '#ffb25a', bri: 0.6 }, [r, g, b] = hexToRgb(base.color), rgb = (r << 16) + (g << 8) + b;
    const n = Math.max(3, Math.min(10, Math.round(ms / 150))), steps = [];
    for (let i = 0; i < n; i++) steps.push(`${Math.round(ms / n)},1,${rgb},${Math.max(1, Math.round(base.bri * 100 * (0.45 + Math.random() * 0.55)))}`);
    await this.send(id, 'start_cf', [n, 0, steps.join(',')]);
    return wait(ms);
  },
  async stop() { for (const c of this.conns?.values() || []) c.sock.destroy(); this.conns?.clear(); },
};

// One SSDP answer → a lamp, or null. Any device on the network may answer, so nothing here may throw.
export function parseSsdp(text) {
  const h = Object.fromEntries(text.split('\r\n').map(l => { const i = l.indexOf(':'); return [l.slice(0, i).trim().toLowerCase(), l.slice(i + 1).trim()]; }));
  const addr = h.location?.replace('yeelight://', ''); if (!addr || !h.id) return null;
  let name = h.name || ''; try { name = decodeURIComponent(name); } catch { }
  return { id: h.id, name: name || `Yeelight ${h.model || ''} ${addr.split(':')[0]}`.replace(/\s+/g, ' '), color: /set_rgb/.test(h.support || ''), addr };
}
// Ask the network for Yeelight lamps; they answer within a second or two.
function ssdp(ms = 2000) {
  return new Promise(resolve => {
    const found = new Map(), sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const done = () => { try { sock.close(); } catch { } resolve([...found.values()]); };
    sock.on('error', done);
    sock.on('message', buf => { const l = parseSsdp(String(buf)); if (l) found.set(l.id, l); });
    sock.bind(() => {
      const msg = Buffer.from(`M-SEARCH * HTTP/1.1\r\nHOST: ${MCAST}:${PORT}\r\nMAN: "ssdp:discover"\r\nST: wifi_bulb\r\n`);
      sock.send(msg, PORT, MCAST); setTimeout(() => sock.send(msg, PORT, MCAST), 300);
      setTimeout(done, ms);
    });
  });
}
