PRAGMA foreign_keys = ON;
CREATE TABLE parcels (
 id TEXT PRIMARY KEY, number TEXT NOT NULL, carrier INTEGER NOT NULL, nickname TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'NotFound', delivered INTEGER NOT NULL DEFAULT 0,
 registration TEXT NOT NULL DEFAULT 'pending', problem TEXT, extras TEXT NOT NULL DEFAULT '{}',
 stopped INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, status_at TEXT NOT NULL DEFAULT '',
 UNIQUE(number, carrier)
);
CREATE TABLE scans (
 id INTEGER PRIMARY KEY AUTOINCREMENT, parcel_id TEXT NOT NULL REFERENCES parcels(id), fingerprint TEXT NOT NULL UNIQUE,
 time TEXT NOT NULL, status TEXT NOT NULL, description TEXT NOT NULL, location TEXT NOT NULL,
 received_at TEXT NOT NULL, digest_id TEXT
);
CREATE INDEX scans_parcel ON scans(parcel_id, time);
CREATE INDEX scans_digest ON scans(digest_id);
CREATE TABLE catalog (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL, refreshed_at TEXT NOT NULL);
CREATE TABLE digests (
 id TEXT PRIMARY KEY, payload TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL,
 first_attempt TEXT, sent_at TEXT, provider_id TEXT, error TEXT
);
CREATE UNIQUE INDEX one_pending_digest ON digests(state) WHERE state='pending';
CREATE TABLE locks (name TEXT PRIMARY KEY, token TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE auth_attempts (bucket TEXT PRIMARY KEY, attempts INTEGER NOT NULL);
