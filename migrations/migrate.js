const fs = require('fs');
const path = require('path');
const { db, initDatabase } = require('../database');

initDatabase();

db.exec(`CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT DEFAULT (datetime('now','localtime'))
)`);

const migrationsDir = __dirname;
const files = fs.readdirSync(migrationsDir)
  .filter((f) => /^\d+_.+\.js$/.test(f))
  .sort();

const applied = new Set(
  db.prepare('SELECT version FROM schema_version').all().map((r) => r.version)
);

let count = 0;
for (const file of files) {
  const version = parseInt(file, 10);
  if (applied.has(version)) {
    console.log(`[migrate] skip    ${file} (already applied)`);
    continue;
  }
  const migrate = require(path.join(migrationsDir, file));
  const run = db.transaction(() => {
    migrate.up(db);
    db.prepare('INSERT INTO schema_version (version, name) VALUES (?, ?)').run(version, file);
  });
  run();
  count += 1;
  console.log(`[migrate] applied ${file}`);
}

console.log(`[migrate] done, ${count} migration(s) applied`);
db.close();
