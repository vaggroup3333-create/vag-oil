import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { serveManaged } from '../scripts/serve-managed.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function freePort() {
  const server = http.createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port; await new Promise(done => server.close(done)); return port;
}
let generations = 0, writes = [], stopDuringWrite = false, busy = 0, fatal = null;
function launch({ port }) {
  const generation = ++generations;
  let expected = false, resolveExit;
  const exited = new Promise(resolve => { resolveExit = resolve; });
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const part of req) body += part;
    busy++;
    const ms = Number(new URL(req.url, 'http://fixture').searchParams.get('delay') || 0);
    if (ms) await delay(ms);
    if (req.method === 'POST') writes.push(body);
    busy--;
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ body, generation, host: req.headers.host }));
  });
  return {
    ready: delay(40).then(async () => { server.listen(port, '127.0.0.1'); await once(server, 'listening'); }),
    exited, get expectedExit() { return expected; },
    async stop() {
      expected = true; if (busy) stopDuringWrite = true;
      await new Promise(done => server.close(done)); resolveExit({ code: 0 });
    },
  };
}
const port = await freePort(), backendPort = await freePort();
const app = await serveManaged({ port, backendPort, launch, config: 'fixture', state: 'fixture',
  drainMs: 40, minAgeMs: 0, pollMs: 600000, memory: async () => 2 ** 30,
  onFatal: e => { fatal = e; } });
const send = async (body, extra = '') => {
  const res = await fetch(`http://127.0.0.1:${port}/${extra}`, { method: 'POST', body });
  assert.equal(res.status, 200); return res.json();
};
try {
  assert.equal((await send('first')).host, `127.0.0.1:${port}`);
  console.log('PASS original Host and request body preserved');
  const replacement = app.recycle();
  const queued = await Promise.all(Array.from({ length: 30 }, (_, i) => send('queued-' + i)));
  assert.equal(await replacement, true);
  assert.ok(queued.every(x => x.generation === 2));
  assert.ok(Array.from({ length: 30 }, (_, i) => writes.filter(w => w === 'queued-' + i).length).every(n => n === 1));
  console.log('PASS 30 queued writes delivered exactly once across replacement');

  const slow = send('slow-no-interrupt', '?delay=150');
  while (!busy) await delay(2);
  const before = generations;
  const recycle = app.recycle(); const during = send('during-deferred-recycle');
  assert.equal(await recycle, false); await slow; await during;
  assert.equal(generations, before); assert.equal(stopDuringWrite, false);
  console.log('PASS prolonged write defers replacement and queued requests continue');

  const short = send('short-finish-first', '?delay=20');
  while (!busy) await delay(2);
  assert.equal(await app.recycle(), true); await short;
  assert.equal(stopDuringWrite, false);
  console.log('PASS active write completes before old worker stops');

  await new Promise((resolveDisconnect, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: '/?delay=25', method: 'POST', headers: { 'Content-Length': '18' } });
    req.on('error', () => {}); req.end('disconnected-write');
    (async () => {
      while (!busy) await delay(2);
      req.destroy(); assert.equal(await app.recycle(), true);
      assert.equal(writes.filter(x => x === 'disconnected-write').length, 1);
      assert.equal(stopDuringWrite, false); resolveDisconnect();
    })().catch(reject);
  });
  console.log('PASS browser disconnect after submitting body does not cancel write');
  const prior = generations; await app.checkMemory();
  assert.equal(generations, prior + 1); assert.equal((await send('after-memory')).body, 'after-memory');
  assert.equal(app.active, 0); assert.equal(fatal, null);
  console.log('PASS memory threshold rotates worker while listener stays available');
} finally { await app.close(); }
console.log(JSON.stringify({ passed: 6, writes: writes.length, generations, stopDuringWrite }));
