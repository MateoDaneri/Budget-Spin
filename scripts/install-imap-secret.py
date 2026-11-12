#!/usr/bin/env python3
"""Install IMAP credentials through a terminal and Docker stdin, never argv.

This stages credentials only. It does not start or change the scheduler.
Run on the Docker host in an interactive terminal, never through a chat.
"""
import getpass
import json
import re
import subprocess
import sys

INSTALL = r'''const fs = require('fs');
const crypto = require('crypto');
const p = '/app/data/imap-credentials.json';
const replace = process.argv[1] === 'replace';
const value = JSON.parse(fs.readFileSync(0, 'utf8'));
if (typeof value.user !== 'string' || typeof value.password !== 'string' || !value.user || !value.password) throw Error('Invalid credential');
// Install via a private sibling file. Never read or save the old credential.
const tmp = p + '.' + crypto.randomUUID() + '.tmp';
let created = false;
try {
  const fd = fs.openSync(tmp, 'wx', 0o600); created = true;
  try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fchownSync(fd, 1000, 1000); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  if (replace) {
    const st = fs.lstatSync(p);
    if (!st.isFile() || st.isSymbolicLink() || (st.mode & 0o077)) throw Error('Existing credential is not a private regular file');
    fs.renameSync(tmp, p); created = false;
  } else {
    fs.linkSync(tmp, p); fs.unlinkSync(tmp); created = false;
  }
} finally { if (created) try { fs.unlinkSync(tmp); } catch {} }
'''

def main():
    if sys.argv[1:] not in ([], ['--replace']):
        raise RuntimeError('Usage: install-imap-secret.py [--replace]')
    if not sys.stdin.isatty():
        raise RuntimeError('Use an interactive terminal for private entry.')
    user = input('Gmail address: ').strip()
    password = getpass.getpass('Gmail app password (input hidden): ').replace(' ', '')
    if not re.fullmatch(r'[^\s@]+@[^\s@]+', user) or not re.fullmatch(r'[A-Za-z]{16}', password):
        raise RuntimeError('Invalid address or app password format.')
    value = json.dumps({'user': user, 'password': password}).encode()
    result = subprocess.run(['docker', 'exec', '-i', '--user', '0', 'budget-spin-app-1',
                             'node', '-e', INSTALL, 'replace' if sys.argv[1:] else 'install'], input=value, stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL, check=False, timeout=30)
    if result.returncode:
        raise RuntimeError('Could not install; file may already exist or Docker may be unavailable.')
    print('Credential staged privately. Scheduler remains unchanged.')

if __name__ == '__main__':
    try:
        main()
    except (Exception, KeyboardInterrupt) as error:
        print('Stopped:', str(error), file=sys.stderr)
        sys.exit(1)
