// db.js — SQLite database setup for Whisper Wall
// Uses node:sqlite — Node's BUILT-IN SQLite module (Node 22.5+, no npm package,
// no native compilation, no Visual Studio / build tools needed on any OS).
// The database file (whisperwall.db) is created automatically on first run.
//
// IMPORTANT: This file intentionally contains NO seed/sample data. The database
// starts completely empty. Every confession, community, and poll you see in the
// app was created by a real user through the UI, and can be deleted by whoever
// created it.

const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.join(__dirname, 'whisperwall.db');
const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// ---------- Schema ----------
db.exec(`
CREATE TABLE IF NOT EXISTS confessions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id      TEXT NOT NULL,
  category      TEXT NOT NULL,
  tags          TEXT NOT NULL DEFAULT '[]',   -- JSON array as string
  text          TEXT NOT NULL,
  report_count  INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reactions (
  confession_id INTEGER NOT NULL,
  owner_id      TEXT NOT NULL,
  type          TEXT NOT NULL,  -- relate | lol | support | shock
  PRIMARY KEY (confession_id, owner_id),
  FOREIGN KEY (confession_id) REFERENCES confessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS comments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  confession_id INTEGER NOT NULL,
  who           TEXT NOT NULL,
  text          TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (confession_id) REFERENCES confessions(id) ON DELETE CASCADE
);

-- Communities are now created by users (owner_id = creator, required to delete)
CREATE TABLE IF NOT EXISTS communities (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  owner_id   TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS joined_communities (
  owner_id      TEXT NOT NULL,
  community_id  INTEGER NOT NULL,
  PRIMARY KEY (owner_id, community_id),
  FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE
);

-- Polls are now created by users (owner_id = creator, required to delete).
-- Multiple polls can exist at once (no single "active" poll restriction).
CREATE TABLE IF NOT EXISTS polls (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  question   TEXT NOT NULL,
  owner_id   TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS poll_options (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  poll_id  INTEGER NOT NULL,
  label    TEXT NOT NULL,
  votes    INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (poll_id) REFERENCES polls(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS poll_votes (
  poll_id   INTEGER NOT NULL,
  owner_id  TEXT NOT NULL,
  PRIMARY KEY (poll_id, owner_id),
  FOREIGN KEY (poll_id) REFERENCES polls(id) ON DELETE CASCADE
);
`);

module.exports = db;
