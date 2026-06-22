const fs = require("fs");
const path = require("path");

let DB = null;
let OSR_SCHEMA_VERSION = "7";
let APP_VERSION = "1.3.0";
let OBJECTIVES_PATH = null;
let OBJECTIVES_EXAMPLE_PATH = null;

function dbJson(value) {
  return JSON.stringify(value ?? {});
}

function isFreshDatabase(db) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' LIMIT 1").get();
  return !row;
}

function currentDatabaseSchemaVersion(db) {
  try {
    const metaTable = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'").get();
    if (!metaTable) return null;
    const row = db.prepare("SELECT value FROM meta WHERE key = 'schemaVersion'").get();
    return row ? String(row.value) : null;
  } catch {
    return null;
  }
}

function resetDatabaseSchema(db, reason) {
  console.log(`Resetting OSR database schema: ${reason}`);
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  db.exec("PRAGMA foreign_keys = OFF;");
  for (const row of rows) {
    db.exec(`DROP TABLE IF EXISTS ${JSON.stringify(row.name)}`);
  }
  db.exec("PRAGMA foreign_keys = ON;");
}

function markMeta(key, value) {
  DB.prepare(`
    INSERT INTO meta (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).run(key, String(value));
}

function initializeDatabase(db, options = {}) {
  DB = db;
  OSR_SCHEMA_VERSION = String(options.schemaVersion || OSR_SCHEMA_VERSION);
  APP_VERSION = String(options.appVersion || APP_VERSION);
  OBJECTIVES_PATH = options.objectivesPath;
  OBJECTIVES_EXAMPLE_PATH = options.objectivesExamplePath;

  const version = currentDatabaseSchemaVersion(DB);
  if (!isFreshDatabase(DB) && version !== OSR_SCHEMA_VERSION) {
    resetDatabaseSchema(DB, version ? `found schema ${version}, expected ${OSR_SCHEMA_VERSION}` : `no supported schema found, expected ${OSR_SCHEMA_VERSION}`);
  }

  DB.exec(`
    CREATE TABLE IF NOT EXISTS state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS app_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      title TEXT,
      description TEXT,
      data_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  markMeta("schemaVersion", OSR_SCHEMA_VERSION);
  markMeta("appVersion", APP_VERSION);
  markMeta("storageMode", "sqlite-json-blob");
}

function readJsonFile(filePath, fallback) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    console.warn(`WARNING: Could not read ${path.basename(filePath)}: ${err.message}`);
    return fallback;
  }
}

function normalizeObjectives(raw = {}) {
  const objectives = Array.isArray(raw.objectives) ? raw.objectives : [];
  const hiddenRoles = Array.isArray(raw.hiddenRoles) ? raw.hiddenRoles : [];
  return {
    enabled: raw.enabled !== false,
    assignmentsPerPlayer: Number.isFinite(Number(raw.assignmentsPerPlayer)) ? Number(raw.assignmentsPerPlayer) : 1,
    objectives: objectives.filter(o => o && o.enabled !== false && o.id),
    hiddenRoles: hiddenRoles.filter(r => r && r.enabled !== false && r.id)
  };
}

function readObjectivesFileNormalized() {
  const source = fs.existsSync(OBJECTIVES_PATH || "") ? OBJECTIVES_PATH : OBJECTIVES_EXAMPLE_PATH;
  return normalizeObjectives(readJsonFile(source, { enabled: true, assignmentsPerPlayer: 1, objectives: [], hiddenRoles: [] }));
}

function appendLog(db, type, title, description, data = {}) {
  try {
    db.prepare(`
      INSERT INTO app_log (type, title, description, data_json)
      VALUES (?, ?, ?, ?)
    `).run(String(type || "event"), title || null, description || null, dbJson(data));
  } catch (err) {
    console.warn(`WARNING: Could not append app log: ${err.message}`);
  }
}

module.exports = {
  initializeDatabase,
  readObjectivesFileNormalized,
  appendLog
};
