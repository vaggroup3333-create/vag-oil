import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('backup',Path(__file__).resolve().parents[1]/'scripts/backup-local.py')
backup=importlib.util.module_from_spec(spec);spec.loader.exec_module(backup)

class BackupTest(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();root=Path(self.tmp.name).resolve()
  backup.SOURCE=root/'state';backup.DESTINATION=root/'saved';backup.CONFIG=root/'config'
  backup.CONFIG.mkdir();(backup.CONFIG/'settings').write_text('synthetic configuration')
  dbdir=backup.SOURCE/'v3/d1/test';dbdir.mkdir(parents=True)
  with sqlite3.connect(dbdir/'test.sqlite') as db:
   db.execute('CREATE TABLE ledgers (id TEXT PRIMARY KEY,data TEXT,version INTEGER)')
   db.execute('INSERT INTO ledgers VALUES (?,?,?)',('fixture:live',json.dumps({'products':[{'name':'Fixture','imageKey':'photo.png'}],'entries':[]}),7))
  r2=backup.SOURCE/'v3/r2/test';r2.mkdir(parents=True)
  with sqlite3.connect(r2/'test.sqlite') as db:
   db.execute('CREATE TABLE _mf_objects (key TEXT,blob_id TEXT,size INTEGER)')
   db.execute('INSERT INTO _mf_objects VALUES (?,?,?)',('product-photos/fixture/live/photo.png','blob',5))
  (r2/'blob').write_bytes(b'photo')
 def tearDown(self):self.tmp.cleanup()
 def test_snapshot_and_original_unchanged(self):
  original=backup.ledgers(backup.SOURCE);backup.main()
  saved=list(backup.DESTINATION.iterdir());self.assertEqual(len(saved),1)
  self.assertEqual(backup.ledgers(saved[0]/'state'),original)
  self.assertEqual(backup.ledgers(backup.SOURCE),original)
  m=json.loads((saved[0]/'manifest.json').read_text());self.assertTrue(m['verified']);self.assertEqual(m['photos'],1)
  for name,digest in m['files'].items():self.assertEqual(backup.digest(saved[0]/name),digest)
 def test_missing_photo_never_publishes(self):
  (backup.SOURCE/'v3/r2/test/blob').unlink()
  with self.assertRaises(RuntimeError):backup.main()
  self.assertEqual(list(backup.DESTINATION.iterdir()),[])
 def test_changed_ledger_never_publishes(self):
  original=backup.ledgers(backup.SOURCE)
  with patch.object(backup,'ledgers',side_effect=[original,{'different':(8,'changed')}]):
   with self.assertRaises(RuntimeError):backup.main()
  self.assertEqual(list(backup.DESTINATION.iterdir()),[])
 def test_foreign_history_is_preserved(self):
  old=backup.DESTINATION/'20200101T000000Z';old.mkdir(parents=True)
  (old/'manifest.json').write_text(json.dumps({'format':'other','verified':True,'createdAt':'2020-01-01T00:00:00+00:00'}))
  backup.main();self.assertTrue(old.exists())

unittest.main()
