// Starts the real QuestSound server (server.js from QS_SERVER_DIR) on a given port, for the link tests.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const SERVER_DIR = process.env.QS_SERVER_DIR || '';
export const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function startQS(port = 20000 + Math.floor(Math.random() * 20000)) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qsl-test-'));
  const p = spawn(process.execPath, ['server.js'], { cwd: SERVER_DIR, stdio: 'ignore', env: { ...process.env, PORT: String(port), DATA_DIR: dir, METRIKA_ID: 'off' } });
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; ; i++) {
    try { if ((await fetch(url + '/api/time')).ok) break; } catch { }
    if (i > 100) throw new Error('server did not start');
    await sleep(50);
  }
  return { url, port, stop() { p.kill(); try { fs.rmSync(dir, { recursive: true, force: true }); } catch { } } };
}

export async function post(url, body, headers = {}) {
  const r = await fetch(url, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...headers } });
  let json = null; try { json = await r.json(); } catch { }
  return { status: r.status, json };
}

// waits until fn() is truthy
export async function until(fn, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(25); }
  throw new Error('timed out');
}
