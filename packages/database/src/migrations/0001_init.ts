import type { Migration } from '../migrate';

export const m0001_init: Migration = {
  version: 1,
  name: '0001_init',
  up: `
CREATE TABLE filter_categories (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_enabled  INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE filters (
  id             TEXT PRIMARY KEY,
  slug           TEXT NOT NULL UNIQUE,
  display_name   TEXT NOT NULL,
  source_name    TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  category_id    TEXT NOT NULL REFERENCES filter_categories(id) ON DELETE RESTRICT,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  is_enabled     INTEGER NOT NULL DEFAULT 1,
  ncp_blob       BLOB NOT NULL,
  ncp_sha256     TEXT NOT NULL UNIQUE,
  parser_version INTEGER NOT NULL,
  parsed_json    TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_filters_enabled_sort ON filters (is_enabled, sort_order);
CREATE INDEX idx_filters_category ON filters (category_id);

CREATE TABLE admins (
  id                  TEXT PRIMARY KEY,
  username            TEXT NOT NULL UNIQUE,
  password_hash       TEXT NOT NULL,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  password_changed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE admin_sessions (
  id           TEXT PRIMARY KEY,
  admin_id     TEXT NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  csrf_secret  TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_sessions_admin ON admin_sessions (admin_id);
CREATE INDEX idx_sessions_expires ON admin_sessions (expires_at);
`,
};
