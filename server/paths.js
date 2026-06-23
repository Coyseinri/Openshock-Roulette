const path = require("path");

function createServerPaths(appRoot, env = process.env) {
  const CONFIG_DIR = path.join(appRoot, "config");
  const DATA_DIR = path.join(appRoot, "data");
  const DEFAULT_DB_PATH = path.join(DATA_DIR, "osr.db");

  return {
    APP_ROOT: appRoot,
    CONFIG_DIR,
    CONFIG_EXAMPLE_PATH: path.join(CONFIG_DIR, "config.example.json"),
    EVENT_CARDS_EXAMPLE_PATH: path.join(CONFIG_DIR, "event-cards.example.json"),
    CONFIG_PATH: path.join(CONFIG_DIR, "config.json"),
    EVENT_CARDS_PATH: path.join(CONFIG_DIR, "event-cards.json"),
    OBJECTIVES_PATH: path.join(CONFIG_DIR, "objectives.json"),
    OBJECTIVES_EXAMPLE_PATH: path.join(CONFIG_DIR, "objectives.example.json"),
    SHOCKERS_EXAMPLE_PATH: path.join(CONFIG_DIR, "shockers.example.json"),
    SHOCKERS_PATH: path.join(CONFIG_DIR, "shockers.json"),
    LEGACY_SHOCKERS_PATH: path.join(appRoot, "shockers.json"),
    LEGACY_SESSION_STATE_PATH: path.join(appRoot, "session-state.json"),
    DATA_DIR,
    DEFAULT_DB_PATH,
    DB_PATH: path.resolve(appRoot, env.OSR_DB_PATH || env.DB_PATH || DEFAULT_DB_PATH),
    SESSION_ARCHIVE_DIR: path.join(appRoot, "session-archive"),
    LOG_DIR: path.join(appRoot, "logs")
  };
}

module.exports = { createServerPaths };
