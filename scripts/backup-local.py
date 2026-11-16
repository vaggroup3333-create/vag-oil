#!/usr/bin/env python3
"""Private online SQLite/photo snapshots for the Linux self-hosted installation."""
from datetime import datetime, timezone, timedelta
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import time
from urllib.parse import quote

SOURCE = Path('/var/lib/vag-oil/state')
DESTINATION = Path('/var/backups/vag-oil/automatic')
CONFIG = Path('/etc/vag-oil')
FORMAT = 'vag-oil-local-backup-v1'


def digest(p):
    with p.open('rb') as f: return hashlib.file_digest(f, 'sha256').hexdigest()


def ledgers(root):
    result = {}
    for p in (root/'v3/d1').rglob('*.sqlite'):
        with sqlite3.connect('file:'+str(p)+'?mode=ro', uri=True, timeout=5) as db:
            if db.execute("SELECT 1 FROM sqlite_master WHERE name='ledgers'").fetchone():
                for key, data, version in db.execute('SELECT id,data,version FROM ledgers'):
                    result[key] = (version, hashlib.sha256(data.encode()).hexdigest())
    return result


def remove_own_directory(p):
    assert p.parent == DESTINATION and p.resolve().parent == DESTINATION.resolve()
    assert re.fullmatch(r'(?:\.partial-)?\d{8}T\d{6}Z', p.name)
    assert not p.is_symlink()
    shutil.rmtree(p)


def main():
    os.umask(0o077)
    assert SOURCE.is_dir() and SOURCE.resolve() == SOURCE
    DESTINATION.mkdir(parents=True, exist_ok=True, mode=0o700)
    now = datetime.now(timezone.utc)
    name = now.strftime('%Y%m%dT%H%M%SZ')
    temporary = DESTINATION/('.partial-'+name)
    final = DESTINATION/name
    assert not temporary.exists() and not final.exists()
    before = ledgers(SOURCE)
    if not before: raise RuntimeError('No ledgers found; refusing an empty backup')
    files = [p for p in SOURCE.rglob('*') if p.is_file() and not p.is_symlink()
             and not p.name.endswith(('-wal', '-shm'))]
    required = sum(p.stat().st_size for p in files)
    if shutil.disk_usage(DESTINATION).free < required*2 + 512*1024*1024:
        raise RuntimeError('Insufficient free space for a verified backup')
    temporary.mkdir(mode=0o700)
    try:
        started = time.monotonic()
        def progress(*_):
            if time.monotonic()-started > 90: raise TimeoutError('Backup time limit')
        for p in files:
            target = temporary/'state'/p.relative_to(SOURCE)
            target.parent.mkdir(parents=True, exist_ok=True)
            if p.suffix == '.sqlite':
                with sqlite3.connect('file:'+str(p)+'?mode=ro', uri=True, timeout=5) as source:
                    with sqlite3.connect(target) as dest:
                        source.backup(dest, pages=256, progress=progress)
                        if dest.execute('PRAGMA integrity_check').fetchall() != [('ok',)]:
                            raise RuntimeError('Backup database integrity failed')
            else: shutil.copy2(p, target)
        if ledgers(temporary/'state') != before or ledgers(SOURCE) != before:
            raise RuntimeError('Records changed during backup; next run will retry')
        # Verify every product image in the captured ledger has a saved R2 blob.
        refs = set(); objects = {}
        for p in (temporary/'state').rglob('*.sqlite'):
            with sqlite3.connect(p) as db:
                tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                if 'ledgers' in tables:
                    for key, raw in db.execute('SELECT id,data FROM ledgers'):
                        owner, mode = key.rsplit(':', 1)
                        for product in json.loads(raw).get('products', []):
                            if product.get('imageKey'):
                                refs.add('product-photos/'+quote(owner, safe='')+'/'+mode+'/'+product['imageKey'])
                if '_mf_objects' in tables:
                    objects.update({key:(blob,size) for key,blob,size in db.execute('SELECT key,blob_id,size FROM _mf_objects')})
        blobs = {p.name:p for p in (temporary/'state/v3/r2').rglob('*') if p.is_file()}
        for ref in refs:
            blob, size = objects[ref]
            if blob not in blobs or blobs[blob].stat().st_size != size:
                raise RuntimeError('A referenced photo is missing from backup')
        shutil.copytree(CONFIG, temporary/'config', symlinks=False)
        manifest = {'format':FORMAT, 'createdAt':now.isoformat(), 'verified':True,
                    'ledgers':before, 'photos':len(refs),
                    'files':{str(p.relative_to(temporary)):digest(p) for p in temporary.rglob('*') if p.is_file()}}
        (temporary/'manifest.json').write_text(json.dumps(manifest, indent=2))
        # Re-read the actual saved files before publishing the completed snapshot.
        for name, sha in manifest['files'].items():
            if digest(temporary/name) != sha: raise RuntimeError('Backup checksum mismatch')
        temporary.rename(final)
    except Exception:
        remove_own_directory(temporary)
        raise
    # Only this script's verified snapshots, never manually created backup history.
    cutoff = now-timedelta(days=14)
    for p in DESTINATION.iterdir():
        if not p.is_dir() or not re.fullmatch(r'\d{8}T\d{6}Z', p.name): continue
        try: saved = json.loads((p/'manifest.json').read_text())
        except (OSError, ValueError): continue
        if (saved.get('format') == FORMAT and saved.get('verified') is True
                and datetime.fromisoformat(saved['createdAt']) < cutoff):
            remove_own_directory(p)
    print('VAG Oil backup verified:', final.name, 'photo references:', len(refs))


if __name__ == '__main__': main()
