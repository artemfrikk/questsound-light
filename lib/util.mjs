// Small helpers shared by the modules.
export const hexToRgb = hex => { const n = parseInt(hex.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
export const sleep = ms => new Promise(r => setTimeout(r, ms));

// fetch with a timeout and a readable error ("401 Unauthorized", "timeout"); returns parsed JSON or text
export async function request(url, { method = 'GET', headers = {}, body, timeout = 6000 } = {}) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, { method, headers, body, signal: ctl.signal });
    const text = await r.text();
    // only the status goes into the error: errors reach the site, and a reply body from a home network must not
    if (!r.ok) throw new Error(`${r.status} ${r.statusText || ''}`.trim());
    try { return JSON.parse(text); } catch { return text; }
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('timeout: ' + url.replace(/\?.*/, ''));
    throw e.cause?.code ? new Error(`${e.cause.code}: ${url.replace(/\?.*/, '')}`) : e;
  } finally { clearTimeout(t); }
}
export const list = s => String(s || '').split(/[,\n]/).map(x => x.trim()).filter(Boolean);
