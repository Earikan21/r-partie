const { db, DEFAULT_SETTINGS } = require('./db');
const { submissionWindow, longDate } = require('./window');

function getSettings() {
  const settings = { ...DEFAULT_SETTINGS };
  for (const row of db.prepare('SELECT key, value FROM settings').all()) {
    settings[row.key] = row.value;
  }
  return settings;
}

function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value);
}

function slugify(text, fallback = 'item') {
  return (
    (text || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || fallback
  );
}

/** Every render gets: the owner (or null), the site copy, and the window. */
function loadContext(req, res, next) {
  res.locals.owner = req.session.ownerId
    ? db.prepare('SELECT id, email, name FROM owners WHERE id = ?').get(req.session.ownerId)
    : null;
  res.locals.settings = getSettings();
  res.locals.window = submissionWindow(res.locals.settings);
  res.locals.longDate = longDate;
  res.locals.flash = req.session.flash || null;
  res.locals.path = req.path;
  delete req.session.flash;
  next();
}

/** The only guard there is: you are the owner, or you are a reader. */
function requireOwner(req, res, next) {
  if (!res.locals.owner) {
    req.session.flash = { type: 'error', message: 'Sign in to reach the desk.' };
    return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
  }
  next();
}

module.exports = { getSettings, setSetting, slugify, loadContext, requireOwner };
