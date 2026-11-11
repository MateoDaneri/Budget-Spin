import importlib.util
from pathlib import Path
import unittest
import json
import os
import subprocess
import tempfile
from unittest.mock import patch, MagicMock

path = Path(__file__).resolve().parents[2] / 'scripts' / 'install-imap-secret.py'
spec = importlib.util.spec_from_file_location('installer', path)
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)

class InstallerTests(unittest.TestCase):
    def test_secret_goes_only_to_stdin(self):
        fake = MagicMock(returncode=0)
        with patch.object(installer.sys, 'argv', ['installer']), patch.object(installer.sys.stdin, 'isatty', return_value=True), patch('builtins.input', return_value='x@example.test'), patch.object(installer.getpass, 'getpass', return_value='abcd efgh ijkl mnop'), patch.object(installer.subprocess, 'run', return_value=fake) as run:
            installer.main()
        args, kwargs = run.call_args
        self.assertNotIn('abcdefghijklmnop', repr(args))
        self.assertIn(b'abcdefghijklmnop', kwargs['input'])
        self.assertEqual(kwargs['stderr'], installer.subprocess.DEVNULL)
    def test_replacement_is_atomic_and_does_not_retain_old_secret(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'credential.json'
            target.write_text('OLD_SYNTHETIC_SECRET')
            target.chmod(0o600)
            script = installer.INSTALL.replace("'/app/data/imap-credentials.json'", json.dumps(str(target)))
            payload = json.dumps({'user': 'new@example.test', 'password': 'NEW_SYNTHETIC_SECRET'}).encode()
            result = subprocess.run(['node', '-e', script, 'replace'], input=payload, capture_output=True)
            self.assertEqual(result.returncode, 0)
            self.assertEqual(target.stat().st_mode & 0o777, 0o600)
            self.assertEqual(json.loads(target.read_text())['password'], 'NEW_SYNTHETIC_SECRET')
            self.assertEqual([p.name for p in Path(directory).iterdir()], ['credential.json'])
            target.chmod(0o644)
            result = subprocess.run(['node', '-e', script, 'replace'], input=payload, capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(json.loads(target.read_text())['password'], 'NEW_SYNTHETIC_SECRET')
            self.assertEqual([p.name for p in Path(directory).iterdir()], ['credential.json'])

    def test_noninteractive_entry_fails_closed(self):
        with patch.object(installer.sys, 'argv', ['installer']), patch.object(installer.sys.stdin, 'isatty', return_value=False), patch.object(installer.subprocess, 'run') as run:
            with self.assertRaises(RuntimeError): installer.main()
            run.assert_not_called()

if __name__ == '__main__': unittest.main()
