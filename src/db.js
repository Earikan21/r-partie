const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'repartie.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  -- Only owners have accounts. Readers never sign in.
  CREATE TABLE IF NOT EXISTS owners (
    id            INTEGER PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS issues (
    id           INTEGER PRIMARY KEY,
    number       INTEGER NOT NULL,
    slug         TEXT NOT NULL UNIQUE,
    title        TEXT NOT NULL,
    dateline     TEXT NOT NULL DEFAULT '',   -- e.g. "Spring 2026"
    intro        TEXT NOT NULL DEFAULT '',
    is_published INTEGER NOT NULL DEFAULT 0,
    published_at TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- An essay inside an issue. Usually a link out; may be hosted here instead.
  CREATE TABLE IF NOT EXISTS pieces (
    id       INTEGER PRIMARY KEY,
    issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    slug     TEXT NOT NULL,
    title    TEXT NOT NULL,
    author   TEXT NOT NULL,
    url      TEXT NOT NULL DEFAULT '',   -- external essay
    body     TEXT NOT NULL DEFAULT '',   -- or the text, hosted here
    blurb    TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL DEFAULT 0,
    UNIQUE (issue_id, slug)
  );

  -- No account required. Name, email, link.
  CREATE TABLE IF NOT EXISTS submissions (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    email       TEXT NOT NULL,
    essay_url   TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rescinded
    owner_notes TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status);
  CREATE INDEX IF NOT EXISTS idx_pieces_issue ON pieces(issue_id, position);
`);

// Everything the owner can rewrite from /admin. Add a key here and it appears
// in the admin form automatically (see GROUPS in src/routes/admin.js).
const DEFAULT_SETTINGS = {
  site_title: 'Repartie',
  site_tagline: 'A newsletter of essays',
  nav_issues: 'Issues',
  nav_about: 'About',
  nav_submit: 'Submit',

  home_heading: 'Repartie',
  home_standfirst:
    'Essays that answer each other back. Published in issues, read in one sitting.',

  issues_heading: 'Past & Present',
  issues_intro: 'Every issue we have published, newest first.',

  about_heading: 'About',
  about_body:
    'Repartie is a newsletter of essays.\n\nWe publish work that has something to say and says it quickly. Each issue is assembled by hand and sent out whole.\n\nWrite to us at hello@example.com.',

  submit_heading: 'Submit',
  submit_intro: 'Send us a link to an essay. If we want it, we will write to you.',
  submit_guidelines:
    'One essay at a time. Any length, though most of what we run runs between 1,500 and 5,000 words.\n\nMake sure the link is public, or readable by anyone who has it.',
  submissions_closed_notice:
    'We are not reading right now. Dates for the next window will be posted here.',
  submissions_thanks: 'Got it. We read everything, and you will hear from us either way.',

  // The submission window. Dates are YYYY-MM-DD.
  submissions_mode: 'scheduled', // scheduled | open | closed
  submissions_opens_on: '',
  submissions_closes_on: '',
  submissions_reply_by: '',

  footer_text: '© Repartie',
};

const insertSetting = db.prepare(
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING'
);
for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) insertSetting.run(key, value);

// First owner, from env, on first boot only.
if (!db.prepare('SELECT id FROM owners LIMIT 1').get()) {
  const email = (process.env.OWNER_EMAIL || 'owner@repartie.local').toLowerCase();
  const password = process.env.OWNER_PASSWORD || 'changeme';
  db.prepare('INSERT INTO owners (email, name, password_hash) VALUES (?, ?, ?)').run(
    email,
    process.env.OWNER_NAME || 'Owner',
    bcrypt.hashSync(password, 10)
  );
  console.log(`Owner account created: ${email} / ${password}`);
  if (password === 'changeme') {
    console.warn('WARNING: default owner password in use. Set OWNER_PASSWORD.');
  }
}

module.exports = { db, DATA_DIR, DEFAULT_SETTINGS };
