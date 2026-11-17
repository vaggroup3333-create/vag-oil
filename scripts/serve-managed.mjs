import http from 'node:http';
import { fork } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Count only this application and its descendants, never another service in a
// shared/user cgroup. The existing systemd limits remain the final safety net.
export async function processTreeRss(pid = process.pid) {
  if (process.platform !== 'linux') return null;
  const seen = new Set();
  async function visit(id) {
    if (seen.has(id)) return 0;
    seen.add(id);
    try {
      const [status, children] = await Promise.all([
        readFile(`/proc/${id}/status`, 'utf8'),
        readFile(`/proc/${id}/task/${id}/children`, 'utf8'),
      ]);
      const rss = Number(status.match(/^VmRSS:\s+(\d+) kB$/m)?.[1] || 0) * 1024;
      const descendants = await Promise.all(children.trim().split(/\s+/).filter(Boolean).map(Number).map(visit));
      return rss + descendants.reduce((sum, value) => sum + value, 0);
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ESRCH') return 0;
      throw error;
    }
  }
  return visit(pid);
}

function launchBackend({ config, state, port }) {
  const child = fork(fileURLToPath(new URL('./serve-worker.mjs', import.meta.url)), [], {
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    env: { ...process.env, VAG_OIL_CONFIG: resolve(config), VAG_OIL_STATE: resolve(state), VAG_OIL_PORT: String(port) },
  });
  let expectedExit = false;
  const exited = new Promise(resolveExit => child.once('exit', (code, signal) => resolveExit({ code, signal })));
  const ready = new Promise((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error('Worker startup timed out')), 15000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', () => { clearTimeout(timer); reject(new Error('Worker exited before ready')); });
    child.on('message', message => {
      if (message?.type === 'vag-oil-ready') { clearTimeout(timer); resolveReady(); }
    });
  });
  return {
    ready, exited, get expectedExit() { return expectedExit; },
    async stop() {
      expectedExit = true;
      child.kill('SIGTERM');
      let timer;
      try {
        const result = await Promise.race([exited, new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Worker did not stop cleanly')), 18000);
        })]);
        if (result.code !== 0) throw new Error('Worker shutdown was not clean');
      } finally { clearTimeout(timer); }
    },
  };
}

export async function serveManaged({
  config, state, port = 9088, backendPort = port + 1,
  recycleBytes = 768 * 1024 * 1024, pollMs = 5000, minAgeMs = 60000,
  drainMs = 5000, queueMs = 18000, maxQueued = 128,
  memory = processTreeRss, launch = launchBackend,
  onFatal = error => { console.error('VAG Oil supervisor:', error.message); process.exit(1); },
} = {}) {
  for (const value of [port, backendPort]) {
    if (!Number.isInteger(value) || value < 1024 || value > 65535) throw new Error('Invalid port');
  }
  if (port === backendPort) throw new Error('Listener and backend ports must differ');
  let backend, active = 0, recycling = false, closing = false, failed = false;
  let started = 0, lastAttempt = 0, checking = false, timer;
  const queue = new Set();
  const idleWaiters = new Set();
  const unavailable = res => {
    if (res.destroyed || res.writableEnded) return;
    if (res.headersSent) return res.destroy();
    res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '3' });
    res.end(JSON.stringify({ error: 'Сервер временно недоступен. Поля оставлены в окне. Повторите сохранение через несколько секунд.' }));
  };
  const fatal = error => {
    if (failed || closing) return;
    failed = true;
    clearInterval(timer);
    for (const item of queue) { clearTimeout(item.timer); unavailable(item.res); }
    queue.clear();
    onFatal(error);
  };
  async function startBackend() {
    backend = launch({ config, state, port: backendPort });
    const current = backend;
    current.exited.then(() => { if (!current.expectedExit) fatal(new Error('Worker exited unexpectedly')); });
    await current.ready;
    started = Date.now();
  }
  function forward(req, res) {
    if (req.aborted || res.destroyed) return;
    active++;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      active--;
      if (!active) for (const notify of idleWaiters) notify();
    };
    const upstream = http.request({ hostname: '127.0.0.1', port: backendPort, method: req.method,
      path: req.url, headers: req.headers, agent: false }, response => {
      if (!res.destroyed) { res.writeHead(response.statusCode, response.headers); response.pipe(res); }
      else response.resume();
      // An abandoned browser response must not cancel an already-submitted write.
      // Drain the backend response before declaring the worker idle.
      res.once('close', () => { if (!response.readableEnded) response.resume(); });
      response.once('end', finish);
      response.once('error', () => { unavailable(res); finish(); });
      response.once('aborted', () => { unavailable(res); finish(); });
    });
    upstream.once('error', () => { unavailable(res); finish(); });
    req.once('aborted', () => { if (!req.complete) upstream.destroy(); });
    req.once('error', () => { if (!req.complete) upstream.destroy(); });
    res.once('error', () => {});
    req.pipe(upstream);
  }
  function flushQueue() {
    for (const item of queue) {
      clearTimeout(item.timer); queue.delete(item);
      if (!failed && !closing) forward(item.req, item.res); else unavailable(item.res);
    }
  }
  const server = http.createServer((req, res) => {
    if (closing || failed) return unavailable(res);
    if (!recycling) return forward(req, res);
    if (queue.size >= maxQueued) return unavailable(res);
    const item = { req, res, timer: null };
    item.timer = setTimeout(() => { queue.delete(item); unavailable(res); }, queueMs);
    queue.add(item);
    res.once('close', () => { if (queue.delete(item)) clearTimeout(item.timer); });
  });
  server.on('clientError', (_, socket) => socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'));
  function waitIdle(timeout) {
    if (!active) return Promise.resolve(true);
    return new Promise(resolveIdle => {
      const done = () => { clearTimeout(deadline); idleWaiters.delete(done); resolveIdle(true); };
      const deadline = setTimeout(() => { idleWaiters.delete(done); resolveIdle(false); }, timeout);
      idleWaiters.add(done);
    });
  }
  async function recycle() {
    if (closing || failed || recycling) return false;
    recycling = true; lastAttempt = Date.now();
    try {
      if (!await waitIdle(drainMs)) return false; // Never interrupt a sale or save.
      if (closing) return false;
      await backend.stop();
      if (closing) return false;
      await startBackend();
      console.log('VAG Oil worker memory released after completed requests');
      return true;
    } catch (error) { fatal(error); return false; }
    finally { recycling = false; flushQueue(); }
  }
  async function checkMemory() {
    if (checking || recycling || closing || failed || Date.now() - Math.max(started, lastAttempt) < minAgeMs) return;
    checking = true;
    try {
      const bytes = await memory();
      if (bytes !== null && bytes >= recycleBytes) await recycle();
    } catch (error) { console.error('VAG Oil memory check:', error.message); }
    finally { checking = false; }
  }
  async function close() {
    if (closing) return;
    closing = true; clearInterval(timer); flushQueue();
    server.close();
    await waitIdle(15000);
    await backend?.stop();
    server.closeAllConnections();
  }
  try {
    await startBackend();
    await new Promise((done, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', done); });
    timer = setInterval(() => void checkMemory(), pollMs); timer.unref();
    console.log(`VAG Oil managed listener ready on 127.0.0.1:${port}`);
    return { close, recycle, checkMemory, get active() { return active; }, get queued() { return queue.size; } };
  } catch (error) { await close(); throw error; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await import('./sites-env.mjs');
  const megabytes = Number(process.env.VAG_OIL_RECYCLE_MB || 768);
  if (!Number.isFinite(megabytes) || megabytes < 256 || megabytes > 4096) throw new Error('Invalid memory threshold');
  const port = Number(process.env.VAG_OIL_PORT || 9088);
  const managed = await serveManaged({
    config: process.env.VAG_OIL_CONFIG || 'dist/server/wrangler.json',
    state: process.env.VAG_OIL_STATE || '/var/lib/vag-oil/state', port,
    backendPort: Number(process.env.VAG_OIL_BACKEND_PORT || port + 1), recycleBytes: megabytes * 1024 * 1024,
  });
  let stopping = false;
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, async () => {
    if (stopping) return; stopping = true;
    const deadline = setTimeout(() => process.exit(1), 25000); deadline.unref();
    try { await managed.close(); process.exit(0); } catch { process.exit(1); }
  });
}
