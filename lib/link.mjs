// The bridge's line to the QuestSound server: it registers a pairing code, then keeps one event stream open
// (commands come in) and posts the state of the lamps back. It reconnects by itself after any drop.
import crypto from 'node:crypto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I
export const newKey = () => crypto.randomBytes(16).toString('hex');
export const newCode = () => Array.from(crypto.randomBytes(6), b => ALPHABET[b % 32]).join('');

// The site gets the key once by typing this code; the code lives 10 minutes on the server.
export async function pair(server, key, code) {
  const r = await fetch(`${server}/api/light/pair`, { method: 'POST', body: JSON.stringify({ code, key }), headers: { 'Content-Type': 'application/json' } });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'HTTP ' + r.status);
}

export function connect({ server, key, onCmd, onReplaced = () => { }, onOnline = () => { }, retryMs = 5000 }) {
  let bridgeId = null, ctl = null, closed = false, timer = null;
  const link = {
    get online() { return !!bridgeId; },
    async sendState(state) {
      if (!bridgeId) return false;
      try {
        const r = await fetch(`${server}/api/light/${key}/state`, { method: 'POST', body: JSON.stringify(state), headers: { 'Content-Type': 'application/json', 'X-Bridge': bridgeId } });
        return r.ok;
      } catch { return false; }
    },
    close() { closed = true; clearTimeout(timer); ctl?.abort(); bridgeId = null; },
  };
  const down = () => { if (bridgeId) { bridgeId = null; onOnline(false); } };
  const event = (ev, data) => {
    if (ev === 'hello') { bridgeId = data.bridgeId; onOnline(true); }
    else if (ev === 'cmd') { try { onCmd(data); } catch (e) { console.error('command failed:', e.message); } }
    else if (ev === 'replaced') { closed = true; down(); ctl.abort(); onReplaced(); }
  };
  (async function run() {
    while (!closed) {
      const my = ctl = new AbortController();
      let quiet = null;
      try {
        const r = await fetch(`${server}/api/light/${key}/stream?role=bridge`, { signal: ctl.signal, headers: { Accept: 'text/event-stream' } });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        let buf = '';
        const watch = () => { clearTimeout(quiet); quiet = setTimeout(() => my.abort(), 60000); }; // the server pings every 20 s: silence means a dead line
        watch();
        for await (const chunk of r.body.pipeThrough(new TextDecoderStream())) {
          watch();
          buf += chunk.replace(/\r\n/g, '\n');
          for (let i; (i = buf.indexOf('\n\n')) >= 0; buf = buf.slice(i + 2)) {
            const block = buf.slice(0, i), ev = block.match(/^event: ?(.*)$/m)?.[1], d = block.match(/^data: ?(.*)$/m)?.[1];
            if (ev && d) { let data; try { data = JSON.parse(d); } catch { continue; } event(ev, data); }
          }
        }
      } catch { }
      clearTimeout(quiet);
      down();
      if (closed) break;
      await new Promise(ok => { timer = setTimeout(ok, retryMs); });
    }
  })();
  return link;
}
