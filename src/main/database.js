// Opens the single-file SQLite database, sets pragmas, and runs migrations.
// Shared instance — every db/*.js module require()s getDatabase() from here.
const path = require('path')
const { app } = require('electron')
const Database = require('better-sqlite3')
const { runMigrations } = require('./db/migrate')

let db = null

// .sql migration files are NOT bundled by vite, so resolve them from source in dev and
// from the packaged resources in production (see electron-builder extraResources later).
function resolveMigrationsDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'migrations')
    : path.join(app.getAppPath(), 'src/main/migrations')
}

function getDatabase() {
  if (db) return db

  const dbPath = path.join(app.getPath('userData'), 'dormy.sqlite')
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL') // safer concurrent reads, crash resilience
  db.pragma('foreign_keys = ON') // SQLite does NOT enforce FKs by default
  runMigrations(db, resolveMigrationsDir())
  return db
}

module.exports = { getDatabase }
