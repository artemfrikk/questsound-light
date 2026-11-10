// A tiny HTTP server that records requests and answers from a route table: { 'GET /api/states': [200, body] }.
import http from 'node:http';

export async function stub(routes) {
  const seen = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      let json = null; try { json = JSON.parse(body); } catch { }
      seen.push({ method: req.method, url: req.url, headers: req.headers, body, json });
      const r = routes[`${req.method} ${req.url.replace(/\?.*/, '')}`] || [404, { error: 'no route' }];
      const out = typeof r[1] === 'function' ? r[1](json) : r[1];
      res.writeHead(r[0], { 'Content-Type': 'application/json' }); res.end(typeof out === 'string' ? out : JSON.stringify(out ?? {}));
    });
  });
  await new Promise(ok => srv.listen(0, '127.0.0.1', ok));
  const host = `127.0.0.1:${srv.address().port}`;
  return { url: `http://${host}`, host, seen, close: () => srv.close() };
}
