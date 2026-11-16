import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('watch',Path(__file__).resolve().parents[1]/'scripts/health-watch.py')
watch=importlib.util.module_from_spec(spec);spec.loader.exec_module(watch)

class WatchTest(unittest.TestCase):
 def step(self,old=None,**changes):
  args=dict(healthy=False,active=True,age=300,invocation='a',now=10000);args.update(changes)
  return watch.decision(old or {},**args)
 def test_three_failures(self):
  state,restart=self.step();self.assertFalse(restart)
  state,restart=self.step(state,now=10060);self.assertFalse(restart)
  state,restart=self.step(state,now=10120);self.assertTrue(restart)
 def test_healthy_resets(self):
  state,_=self.step({'failures':2,'invocation':'a'},healthy=True)
  self.assertEqual(state['failures'],0)
 def test_manual_stop_and_startup(self):
  for changes in [{'active':False},{'age':30}]:
   state,restart=self.step({'failures':8,'invocation':'a'},**changes)
   self.assertFalse(restart);self.assertEqual(state['failures'],0)
 def test_new_process_resets(self):
  state,restart=self.step({'failures':2,'invocation':'previous'})
  self.assertFalse(restart);self.assertEqual(state['failures'],1)
 def test_cooldown_and_hourly_limit(self):
  for times in [[9900],[7100,8100,9000]]:
   _,restart=self.step({'failures':8,'invocation':'a','restarts':times})
   self.assertFalse(restart)
  _,restart=self.step({'failures':8,'invocation':'a','restarts':[9000]})
  self.assertTrue(restart)

unittest.main()
