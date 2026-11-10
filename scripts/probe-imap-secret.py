#!/usr/bin/env python3
"""Check staged credentials and existing OAuth mailbox identity without switching providers."""
import hashlib
import imaplib
import json
import ssl
import subprocess
import sys

READ = r'''const fs=require('fs');
const p='/app/data/imap-credentials.json', s=fs.statSync(p);
if(!s.isFile()||(s.mode&0o077)) throw Error('invalid permissions');
const secret=JSON.parse(fs.readFileSync(p,'utf8'));
const state=JSON.parse(fs.readFileSync('/app/data/ingest-state/gmail-state.json','utf8'));
if(typeof state.account!=='string') throw Error('missing OAuth mailbox identity');
process.stdout.write(JSON.stringify({secret, account:state.account}));'''

def main():
    result = subprocess.run(['docker', 'exec', 'budget-spin-app-1', 'node', '-e', READ],
                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=20, check=False)
    if result.returncode:
        raise RuntimeError('Cannot read staged credentials or existing OAuth account state.')
    data = json.loads(result.stdout)
    secret = data['secret']
    if hashlib.sha256(secret['user'].lower().encode()).hexdigest() != data['account']:
        raise RuntimeError('Staged account differs from the existing OAuth account.')
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
    print('IMAP login and read-only INBOX succeeded for the same account. No messages were read; OAuth remains active.')

if __name__ == '__main__':
    try:
        main()
    except Exception:
        # Provider errors can contain user identifiers or server response details.
        print('IMAP probe failed; check account identity, app password and network. OAuth remains active.', file=sys.stderr)
        sys.exit(1)
