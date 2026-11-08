import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

// D1-compatible adapter so desktop uses the same tested tracking/outbox logic.
export class LocalDatabase {
  constructor(path) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
    if (!this.db.prepare("SELECT name FROM sqlite_master WHERE name='parcels'").get()) {
      this.db.exec(readFileSync(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8'));
    }
  }
  prepare(sql) {
    const stmt = this.db.prepare(sql);
    let values = [];
    const wrapper = {
      bind: (...args) => { values = args; return wrapper; },
      first: () => stmt.get(...values) || null,
      all: () => ({ results: stmt.all(...values) }),
      run: () => ({ meta: { changes: Number(stmt.run(...values).changes) } })
    };
    return wrapper;
  }
  batch(statements) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const results = statements.map(s => s.run()); this.db.exec('COMMIT'); return results; }
    catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  close() { this.db.close(); }
}
