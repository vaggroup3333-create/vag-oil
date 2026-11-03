"""Create a NEW standalone instance, optionally importing a private transfer ZIP.

Requires Python 3.10+, Node.js and a completed pnpm build. Never points at a
remote database and never overwrites an existing installation.
"""
import argparse
import datetime
import getpass
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import uuid
import zipfile

ROOT = Path(__file__).resolve().parent.parent
TARGET = ROOT / '.selfhost-data'
CONFIG = ROOT / 'dist/server/wrangler.json'
CLI = ROOT / 'node_modules/wrangler/bin/wrangler.js'
MAX_FILE = 100 * 1024 * 1024
MAX_ARCHIVE = 1024 * 1024 * 1024


def require(ok, message):
    if not ok:
        raise ValueError(message)


def load_transfer(path):
    """Read named ZIP members only; never extract arbitrary archive paths."""
    with zipfile.ZipFile(path) as archive:
        infos = archive.infolist()
        require(len(infos) <= 10002, 'Too many archive entries')
        require(len({i.filename for i in infos}) == len(infos), 'Duplicate ZIP entry')
        require(sum(i.file_size for i in infos) <= MAX_ARCHIVE, 'Archive too large')
        require(all(i.file_size <= MAX_FILE for i in infos), 'Archive member too large')
        require(archive.getinfo('manifest.json').file_size <= 4 * 1024 * 1024, 'Manifest too large')
        manifest = json.loads(archive.read('manifest.json'))
        require(manifest.get('format') == 'vag-oil-transfer-v1', 'Unsupported archive format')
        app_version = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
        require(manifest.get('applicationVersion') == app_version,
                'Use the same application version as the archive: ' + str(manifest.get('applicationVersion')))
        raw = archive.read('ledger.json')
        require(hashlib.sha256(raw).hexdigest() == manifest.get('ledgerSha256'), 'Ledger checksum mismatch')
        ledger = json.loads(raw)
        require(isinstance(ledger, dict) and isinstance(ledger.get('products'), list)
                and isinstance(ledger.get('entries'), list), 'Invalid ledger')
        version = manifest.get('ledgerVersion')
        require(type(version) is int and version >= 0, 'Invalid ledger version')
        photos = manifest.get('photos')
        require(isinstance(photos, list), 'Invalid photo manifest')
        contents = {}
        for photo in photos:
            key = photo.get('key', '')
            require(re.fullmatch(r'[a-f0-9-]{36}\.(jpg|png|webp|gif)', key), 'Invalid photo key')
            require(photo.get('path') == 'photos/' + key and key not in contents, 'Invalid photo path')
            content = archive.read(photo['path'])
            require(len(content) == photo.get('size') and len(content) <= 10 * 1024 * 1024,
                    'Invalid photo size')
            require(hashlib.sha256(content).hexdigest() == photo.get('sha256'), 'Photo checksum mismatch')
            contents[key] = content
        require({p['imageKey'] for p in ledger['products'] if p.get('imageKey')} == set(contents),
                'Referenced photo set does not match the archive')
        require(set(archive.namelist()) == {'manifest.json', 'ledger.json'} | {'photos/' + k for k in contents},
                'Unexpected archive contents')
        return raw.decode('utf-8'), version, contents, manifest


def credentials(label, optional=False):
    while True:
        login = input(label + ' login' + (' (Enter to skip)' if optional else '') + ': ').strip()
        if optional and not login:
            return None
        if re.fullmatch(r'[A-Za-z0-9._-]{3,32}', login):
            break
        print('Use 3-32 Latin letters, digits, dot, dash or underscore.')
    while True:
        password = getpass.getpass(label + ' NEW password (10-256 characters): ')
        if not (10 <= len(password) <= 256) or not password.strip():
            print('Password must have 10-256 characters.')
        elif password != getpass.getpass('Repeat password: '):
            print('Passwords do not match.')
        else:
            salt = secrets.token_hex(32)
            digest = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), 100000).hex()
            return login, salt, digest


def run_local(node, state, *args):
    env = dict(os.environ, WRANGLER_SEND_METRICS='false', CLOUDFLARE_CF_FETCH_ENABLED='false',
               WRANGLER_WRITE_LOGS='false')
    subprocess.run([node, '--import', str(ROOT / 'scripts/sites-env.mjs'), str(CLI), *args,
                    '--local', '--persist-to', str(state), '--config', str(CONFIG)],
                   cwd=ROOT, env=env, check=True)


def main():
    parser = argparse.ArgumentParser(description='Set up a new VAG Oil instance with your own credentials.')
    parser.add_argument('archive', nargs='?', type=Path, help='Private VAG Oil transfer ZIP (optional)')
    args = parser.parse_args()
    os.umask(0o077)
    require(not TARGET.exists(), 'This instance already has .selfhost-data. Existing data was not changed.')
    require(not (ROOT / '.dev.vars').exists() and not (ROOT / 'dist/server/.dev.vars').exists(),
            'Existing login configuration found. Use a NEW checkout for the new instance.')
    require(CONFIG.is_file() and CLI.is_file(), 'Run pnpm install --frozen-lockfile and pnpm build first.')
    node = shutil.which('node')
    require(node, 'Node.js is not on PATH')
    transfer = load_transfer(args.archive) if args.archive else None
    require(sys.stdin.isatty(), 'Run this setup in an interactive terminal to enter your NEW password.')
    director = credentials('Director')
    cashier = credentials('Cashier', optional=True)
    require(not cashier or cashier[0] != director[0], 'Director and cashier logins must differ.')
    owner = str(uuid.uuid4())
    stage = Path(tempfile.mkdtemp(prefix='.selfhost-import-', dir=ROOT))
    state = stage / 'state'
    try:
        run_local(node, state, 'd1', 'execute', 'DB', '--file', str(ROOT / 'drizzle/0000_massive_praxagora.sql'))
        databases = []
        for path in (state / 'v3/d1').rglob('*.sqlite'):
            with sqlite3.connect(path) as connection:
                if connection.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='ledgers'").fetchone():
                    databases.append(path)
        require(len(databases) == 1, 'Expected one freshly initialized database')
        with sqlite3.connect(databases[0]) as connection:
            require(connection.execute('SELECT COUNT(*) FROM ledgers').fetchone()[0] == 0, 'Database is not empty')
            if transfer:
                raw, version, photos, manifest = transfer
                connection.execute('INSERT INTO ledgers (id,data,version) VALUES (?,?,?)', (owner + ':live', raw, version))
            require(connection.execute('PRAGMA integrity_check').fetchall() == [('ok',)], 'Database integrity failure')
        if transfer:
            types = {'jpg': 'image/jpeg', 'png': 'image/png', 'webp': 'image/webp', 'gif': 'image/gif'}
            for key, content in photos.items():
                temporary = stage / key
                temporary.write_bytes(content)
                run_local(node, state, 'r2', 'object', 'put', 'vag-oil-photos/product-photos/' + owner + '/live/' + key,
                          '--file', str(temporary), '--content-type', types[key.rsplit('.', 1)[1]])
                temporary.unlink()
        values = {'POS_LEDGER_OWNER': owner, 'POS_LOGIN': director[0],
                  'POS_PASSWORD_SALT': director[1], 'POS_PASSWORD_HASH': director[2]}
        if cashier:
            values.update(POS_CASHIER_LOGIN=cashier[0], POS_CASHIER_PASSWORD_SALT=cashier[1], POS_CASHIER_PASSWORD_HASH=cashier[2])
        (stage / '.dev.vars').write_text(''.join(k + '=' + json.dumps(v) + '\n' for k, v in values.items()), encoding='utf-8')
        (stage / 'instance.json').write_text(json.dumps({'format': 'vag-oil-instance-v1',
            'createdUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'importedFromDate': transfer[3].get('createdUtc') if transfer else None}, indent=2), encoding='utf-8')
        require(not TARGET.exists(), 'Target appeared during setup; staging data kept separately')
        stage.rename(TARGET)
    except BaseException:
        print('Setup stopped. No existing installation was overwritten. Private staging folder: ' + str(stage), file=sys.stderr)
        raise
    print('Ready. Start with: pnpm start:local')
    print('Open http://localhost:9088/vag-oil/ on this computer. Use HTTPS for other computers/phones.')
    print('Keep .selfhost-data private and back it up. Do not upload it to GitHub.')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError, zipfile.BadZipFile, KeyError) as error:
        print('Setup failed: ' + str(error), file=sys.stderr)
        sys.exit(1)
