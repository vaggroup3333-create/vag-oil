import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// The CLI's --inspector-port=0 still enables the inspector and retains network
// events in Wrangler 4.92.0. Use the pinned API to explicitly disable it.
export async function serveWorker({ config, state, port = 9088 }) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid port');
  const { unstable_startWorker } = await import('wrangler');
  let worker;
  let stopping = false;
  const stop = async (code = 0) => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => process.exit(1), 15000);
    deadline.unref();
    try { if (worker) await worker.dispose(); }
    finally { process.exit(code); }
  };
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => void stop());
  try {
    worker = await unstable_startWorker({
      config: resolve(config), sendMetrics: false,
      dev: {
        remote: false, persist: resolve(state), inspector: false,
        watch: false, liveReload: false, logLevel: 'error',
        server: { hostname: '127.0.0.1', port },
      },
    });
    await worker.ready;
    if (await worker.inspectorUrl) throw new Error('Inspector must be disabled');
    console.log(`VAG Oil ready on 127.0.0.1:${port}; inspector disabled`);
    if (process.send) process.send({ type: 'vag-oil-ready' });
    return worker;
  } catch (error) {
    console.error('VAG Oil failed to start:', error.message);
    await stop(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await import('./sites-env.mjs');
  await serveWorker({
    config: process.env.VAG_OIL_CONFIG || 'dist/server/wrangler.json',
    state: process.env.VAG_OIL_STATE || '/var/lib/vag-oil/state',
    port: Number(process.env.VAG_OIL_PORT || 9088),
  });
}
