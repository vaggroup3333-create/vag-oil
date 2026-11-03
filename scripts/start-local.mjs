// Standalone instance only: data stays beside this checkout, never in the
// production installation's /var/lib/vag-oil/state directory.
import { readFile, writeFile, chmod } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
process.umask(0o077);
const state = resolve(root, '.selfhost-data/state');
try {
  const marker = JSON.parse(await readFile(resolve(root, '.selfhost-data/instance.json'), 'utf8'));
  if (marker.format !== 'vag-oil-instance-v1') throw new Error('Invalid instance marker');
  const config = await readFile(resolve(root, '.selfhost-data/.dev.vars'));
  await writeFile(resolve(root, 'dist/server/.dev.vars'), config, { mode: 0o600 });
  await chmod(resolve(root, 'dist/server/.dev.vars'), 0o600);
} catch (error) {
  console.error('Build the app and run scripts/setup-instance.py first. ' + error.message);
  process.exit(1);
}
const port = process.env.VAG_OIL_PORT || '9088';
if (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535) throw new Error('Invalid VAG_OIL_PORT');
await import('./sites-env.mjs');
const cli = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
process.argv = [process.execPath, cli, 'dev', '--config', resolve(root, 'dist/server/wrangler.json'),
  '--local', '--persist-to', state, '--ip', '127.0.0.1', '--port', port, '--inspector-port', '0'];
await import(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url).href);
