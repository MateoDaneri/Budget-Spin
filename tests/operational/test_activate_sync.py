import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('activate', Path(__file__).resolve().parents[2] / 'scripts/activate-sync.py')
a = importlib.util.module_from_spec(spec)
spec.loader.exec_module(a)

class ActivationTests(unittest.TestCase):
    def test_refuses_nonisolated_existing_network(self):
        app = {'State': {'Running': True, 'Health': {'Status': 'healthy'}}}
        def fake(*args, **kwargs):
            if args == ('inspect', a.APP): return subprocess.CompletedProcess(args, 0, json.dumps([app]).encode())
            if args[:1] == ('exec',): return subprocess.CompletedProcess(args, 0, b'')
            if args[:1] == ('inspect',): return subprocess.CompletedProcess(args, 1, b'')
            return subprocess.CompletedProcess(args, 0, json.dumps([{'Internal': False}]).encode())
        with patch.object(a, 'docker', side_effect=fake):
            with self.assertRaisesRegex(RuntimeError, 'not isolated'): a.preflight('gmail')

    def test_creates_schedulers_without_secrets_in_docker_arguments(self):
        app = {'State': {'Running': True, 'Health': {'Status': 'healthy'}}, 'NetworkSettings': {'Networks': {}}}
        calls = []
        def fake(*args, **kwargs):
            calls.append((args, kwargs))
            if args == ('inspect', a.APP): return subprocess.CompletedProcess(args, 0, json.dumps([app]).encode())
            if args[:1] == ('inspect',): return subprocess.CompletedProcess(args, 1, b'')
            if args[:2] == ('network', 'inspect'): return subprocess.CompletedProcess(args, 1, b'')
            return subprocess.CompletedProcess(args, 0, b'')
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(a, 'TOKEN', Path(directory) / 'ingest-token'), patch.object(a, 'docker', side_effect=fake), patch.object(a, 'free_subnet', return_value='10.231.0.0/28'), patch.object(a.sys, 'argv', ['activate-sync.py', 'gmail']):
                a.main()
                token = a.TOKEN.read_bytes()
                self.assertEqual(a.TOKEN.stat().st_mode & 0o777, 0o600)
                self.assertEqual(sum(args[0] == 'run' for args, _ in calls), 1)
                for args, _ in calls: self.assertNotIn(token.decode(), repr(args))
                install = [kw for args, kw in calls if args[:2] == ('exec', '-i')]
                self.assertEqual(install[0]['data'], token)

if __name__ == '__main__': unittest.main()
