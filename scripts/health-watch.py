#!/usr/bin/env python3
"""Local VAG Oil readiness watchdog. No credentials or business writes."""
import fcntl
import json
import os
from pathlib import Path
import subprocess
import time
import urllib.request

SERVICE = 'vag-oil.service'
STATE = Path('/var/lib/vag-oil-health')
PAUSE = Path('/run/vag-oil-maintenance')
URL = 'http://127.0.0.1:9088/vag-oil/api/health'


def decision(old, *, healthy, active, age, invocation, now):
    """Three failures, startup grace, restart cooldown and hourly restart cap."""
    restarts = [t for t in old.get('restarts', []) if 0 <= now-t < 3600]
    failures = old.get('failures', 0) if old.get('invocation') == invocation else 0
    if not active or age < 120 or healthy:
        failures = 0
    else:
        failures += 1
    restart = (active and age >= 120 and failures >= 3 and len(restarts) < 3
               and (not restarts or now-restarts[-1] >= 900))
    if restart:
        restarts.append(now)
        failures = 0
    return {'failures': failures, 'restarts': restarts, 'invocation': invocation}, restart


def main():
    STATE.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (STATE/'lock').open('a') as lock:
        try: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError: return
        if PAUSE.exists(): return
        result = subprocess.run(['systemctl', 'show', SERVICE,
            '--property=ActiveState,ActiveEnterTimestampMonotonic,InvocationID'],
            check=True, capture_output=True, text=True, timeout=10)
        props = dict(line.split('=', 1) for line in result.stdout.splitlines() if '=' in line)
        active = props.get('ActiveState') == 'active'
        age = time.monotonic()-int(props.get('ActiveEnterTimestampMonotonic') or 0)/1e6
        healthy = False
        if active and age >= 120:
            try:
                # No redirects, environment proxies, authentication or unbounded body.
                class NoRedirect(urllib.request.HTTPRedirectHandler):
                    def redirect_request(self, *args, **kwargs): return None
                opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
                with opener.open(URL, timeout=8) as response:
                    healthy = response.status == 200 and json.loads(response.read(1024)) == {'ok': True}
            except Exception: pass
        try: old = json.loads((STATE/'status.json').read_text())
        except (FileNotFoundError, ValueError): old = {}
        state, restart = decision(old, healthy=healthy, active=active, age=age,
            invocation=props.get('InvocationID', ''), now=time.time())
        state.update(checkedAt=time.time(), healthy=healthy, active=active)
        temporary = STATE/'status.tmp'
        temporary.write_text(json.dumps(state));temporary.chmod(0o600)
        temporary.replace(STATE/'status.json')
        if restart and not PAUSE.exists():
            # Recheck state to avoid undoing an intentional stop or deployment.
            current = subprocess.run(['systemctl', 'show', SERVICE, '--property=InvocationID,ActiveState'],
                check=True, capture_output=True, text=True, timeout=10).stdout
            if ('ActiveState=active' in current and 'InvocationID='+state['invocation'] in current):
                print('VAG Oil readiness failed three times; restarting its service only.', flush=True)
                subprocess.run(['systemctl', 'restart', SERVICE], check=True, timeout=60)
        elif active and age >= 120 and not healthy:
            print('VAG Oil readiness check failed; consecutive failures:', state['failures'], flush=True)


if __name__ == '__main__': main()
