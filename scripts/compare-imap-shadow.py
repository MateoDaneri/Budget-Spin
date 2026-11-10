#!/usr/bin/env python3
"""Compare private SQLite snapshots, reporting counts only, never IDs or data."""
import sqlite3
import sys
from pathlib import Path

def main():
    if len(sys.argv) != 3:
        raise RuntimeError('Expected fresh production snapshot and shadow snapshot')
    prod, shadow = (Path(arg).resolve(strict=True) for arg in sys.argv[1:])
    if prod == shadow:
        raise RuntimeError('Snapshots must be distinct')
    with sqlite3.connect(prod.as_uri() + '?mode=ro', uri=True) as db:
        db.execute('ATTACH DATABASE ? AS shadow', (shadow.as_uri() + '?mode=ro',))
        integrity = db.execute('PRAGMA integrity_check').fetchone()[0]
        shadow_integrity = db.execute('PRAGMA shadow.integrity_check').fetchone()[0]
        if integrity != 'ok' or shadow_integrity != 'ok': raise RuntimeError('Integrity check failed')
        query = '''SELECT count(*) FROM transactions p LEFT JOIN shadow.transactions s
          ON p.user_id=s.user_id AND p.message_id=s.message_id
          WHERE p.source='itau_email' AND p.message_id IS NOT NULL AND s.id IS NULL'''
        missing_shadow = db.execute(query).fetchone()[0]
        query = '''SELECT count(*) FROM shadow.transactions s LEFT JOIN transactions p
          ON p.user_id=s.user_id AND p.message_id=s.message_id
          WHERE s.source='itau_email' AND s.message_id IS NOT NULL AND p.id IS NULL'''
        new_shadow = db.execute(query).fetchone()[0]
        query = '''SELECT count(*) FROM transactions p JOIN shadow.transactions s
          ON p.user_id=s.user_id AND p.message_id=s.message_id
          WHERE p.source='itau_email' AND (p.txn_date IS NOT s.txn_date OR p.amount_minor IS NOT s.amount_minor OR p.currency_code IS NOT s.currency_code OR p.kind IS NOT s.kind)'''
        differences = db.execute(query).fetchone()[0]
        print(f'Production messages missing in shadow: {missing_shadow}; shadow-only messages: {new_shadow}; shared financial values differing: {differences}.')
        print('Counts alone do not prove mailbox coverage or preserve live category changes; reconcile before switch.')

if __name__ == '__main__':
    try: main()
    except Exception:
        print('Snapshot comparison failed; no production database was modified.', file=sys.stderr)
        sys.exit(1)
