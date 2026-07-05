import sqlite3
import sys

try:
    print("Connecting to SQLite database...")
    conn = sqlite3.connect('market_research_v2.db', timeout=5)
    cursor = conn.cursor()
    print("Running WAL checkpoint truncate...")
    cursor.execute('PRAGMA wal_checkpoint(TRUNCATE)')
    print("Checkpoint successful!")
    conn.close()
except Exception as e:
    print("Error:", e, file=sys.stderr)
    sys.exit(1)
