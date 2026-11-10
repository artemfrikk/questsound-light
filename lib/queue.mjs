// Lamps are slow: a slider can produce dozens of values a second, a lamp takes a few. The queue keeps only
// the newest value for each lamp and sends it as soon as the lamp's rate allows, so nothing piles up.
//   per lamp:  makeQueue({ rate, send(id, value), onError(id, err) })     — rate = sends a second for each lamp
//   shared:    makeQueue({ rate, shared: true, sendMany({id: value}) })   — one rate for the whole module, batched
export function makeQueue({ rate, send, sendMany, shared = false, onError = () => { } }) {
  const gap = 1000 / rate, slots = new Map(); // key → { pending: Map(id → value), last, timer, busy }
  const slot = key => { let s = slots.get(key); if (!s) slots.set(key, s = { pending: new Map(), last: 0, timer: null, busy: false }); return s; };
  async function flush(s) {
    s.timer = null;
    if (s.busy || !s.pending.size) return;
    const wait = s.last + gap - Date.now();
    if (wait > 0) { s.timer = setTimeout(() => flush(s), wait); return; }
    const batch = new Map(s.pending); s.pending.clear();
    s.busy = true; s.last = Date.now();
    if (shared) {
      try { await sendMany(Object.fromEntries(batch)); } catch (e) { for (const id of batch.keys()) onError(id, e); }
    } else {
      const [[id, v]] = batch;
      try { await send(id, v); } catch (e) { onError(id, e); }
    }
    s.busy = false;
    if (s.pending.size && !s.timer) flush(s);
  }
  return function push(id, value) {
    const s = slot(shared ? '*' : id);
    s.pending.set(id, value);
    if (!s.timer && !s.busy) s.timer = setTimeout(() => flush(s), 0); // values set in the same moment go together
  };
}
