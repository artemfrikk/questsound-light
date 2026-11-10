// MQTT: for Zigbee2MQTT and anything else that listens on an MQTT broker. A minimal MQTT 3.1.1 client
// (connect, publish QoS 0, ping) with no packages. Each lamp is a line "name=topic"; the bridge publishes
// to "topic/set" a Zigbee2MQTT-style message: {"state":"ON","brightness":0–254,"color":{"r","g","b"},"transition":s}.
import net from 'node:net';
import crypto from 'node:crypto';
import { hexToRgb } from '../lib/util.mjs';

const str = s => { const b = Buffer.from(s, 'utf8'); const l = Buffer.alloc(2); l.writeUInt16BE(b.length); return Buffer.concat([l, b]); };
function packet(type, body) {
  const len = []; let n = body.length;
  do { let d = n % 128; n = Math.floor(n / 128); if (n) d |= 128; len.push(d); } while (n);
  return Buffer.concat([Buffer.from([type, ...len]), body]);
}

export default {
  id: 'mqtt', name: 'MQTT', rate: 10,
  settings: [
    { key: 'host', label: 'Адрес брокера', placeholder: '192.168.1.10' },
    { key: 'port', label: 'Порт', optional: true, placeholder: '1883' },
    { key: 'user', label: 'Логин', optional: true },
    { key: 'pass', label: 'Пароль', optional: true, secret: true },
    { key: 'lamps', label: 'Лампы: «название=тема», по одной в строке', placeholder: 'Потолок=zigbee2mqtt/Потолок' },
  ],
  async start(s) {
    if (!s.host) throw new Error('нужен адрес брокера');
    this.s = s; this.closed = false; this.gen = (this.gen || 0) + 1; // a socket from an older start never reconnects
    this.topics = new Map(String(s.lamps || '').split(/[\n,]/).map(l => l.split('=').map(x => x.trim())).filter(([n, t]) => n && t)
      .map(([n, t]) => [n, t.endsWith('/set') ? t : t + '/set']));
    await this.connect();
  },
  connect() {
    return new Promise((ok, fail) => {
      const { host, port, user, pass } = this.s, gen = this.gen;
      const sock = net.createConnection(+port || 1883, host);
      let flags = 0x02; const parts = [str('MQTT'), Buffer.from([4])];
      if (user) flags |= 0x80; if (pass) flags |= 0x40;
      parts.push(Buffer.from([flags, 0, 60]), str('questsound-light-' + crypto.randomBytes(4).toString('hex')));
      if (user) parts.push(str(user)); if (pass) parts.push(str(pass));
      const t = setTimeout(() => { sock.destroy(); fail(new Error('timeout: брокер не отвечает')); }, 5000);
      sock.once('data', d => {
        clearTimeout(t);
        if (d[0] >> 4 !== 2 || d[3] !== 0) { sock.destroy(); return fail(new Error('брокер отказал в подключении, код ' + d[3] + (d[3] === 4 || d[3] === 5 ? ' (логин или пароль)' : ''))); }
        this.sock = sock;
        this.ping = setInterval(() => sock.write(Buffer.from([0xc0, 0])), 30000);
        ok();
      });
      sock.on('error', e => { clearTimeout(t); fail(e); });
      sock.on('close', () => { clearInterval(this.ping); if (this.sock === sock) this.sock = null; if (!this.closed && gen === this.gen) setTimeout(() => !this.closed && gen === this.gen && !this.sock && this.connect().catch(() => { }), 5000); });
      sock.write(packet(0x10, Buffer.concat(parts)));
    });
  },
  async discover() { return [...this.topics.keys()].map(n => ({ id: n, name: n, caps: { color: true, fast: true } })); },
  async set(id, t) {
    const topic = this.topics.get(id);
    if (!topic) throw new Error('нет темы для лампы');
    if (!this.sock) throw new Error('нет связи с брокером');
    const msg = t === 'off' || t.bri <= 0 ? { state: 'OFF' }
      : { state: 'ON', brightness: Math.max(1, Math.round(t.bri * 254)), color: Object.fromEntries(['r', 'g', 'b'].map((k, i) => [k, hexToRgb(t.color)[i]])), transition: t.fade };
    this.sock.write(packet(0x30, Buffer.concat([str(topic), Buffer.from(JSON.stringify(msg))])));
  },
  async stop() { this.closed = true; clearInterval(this.ping); if (this.sock) { this.sock.write(Buffer.from([0xe0, 0])); this.sock.end(); } this.sock = null; },
};
