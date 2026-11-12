#!/usr/bin/env python3
"""Check the staged IMAP credential with a login and read-only INBOX open; reads no messages."""
import imaplib
import json
import ssl
import subprocess
import sys

READ = r'''const fs=require('fs');
const p='/app/data/imap-credentials.json', s=fs.statSync(p);
if(!s.isFile()||(s.mode&0o077)) throw Error('invalid permissions');
process.stdout.write(fs.readFileSync(p,'utf8'));'''

def main():
    result = subprocess.run(['docker', 'exec', 'budget-spin-app-1', 'node', '-e', READ],
                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=20, check=False)
    if result.returncode:
        raise RuntimeError('Cannot read staged credentials.')
    secret = json.loads(result.stdout)
    connection = imaplib.IMAP4_SSL('imap.gmail.com', 993, ssl_context=ssl.create_default_context(), timeout=20)
    try:
        status, _ = connection.login(secret['user'], secret['password'])
        if status != 'OK':
            raise RuntimeError('Login failed.')
        status, _ = connection.select('INBOX', readonly=True)
        if status != 'OK':
            raise RuntimeError('Read-only INBOX open failed.')
    finally:
        try:
            connection.logout()
        except Exception:
            pass
    print('IMAP login and read-only INBOX succeeded. No messages were read.')

if __name__ == '__main__':
    try:
        main()
    except Exception:
        # Provider errors can contain user identifiers or server response details.
        print('IMAP probe failed; check account, app password and network.', file=sys.stderr)
        sys.exit(1)
