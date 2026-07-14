const express = require('express');
const { db } = require('../db');

const router = express.Router();

/** Only http(s), and it must parse. Keeps javascript: out of an href. */
function cleanUrl(raw) {
  try {
    const url = new URL((raw || '').trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.href;
  } catch {
    return null;
  }
}

const looksLikeEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

router.get('/submit', (req, res) => {
  res.render('submit', { values: {}, error: null, sent: false });
});

router.post('/submit', (req, res) => {
  // The window decides, not the form. A stale page cannot post into a closed window.
  if (!res.locals.window.isOpen) {
    return res.status(403).render('submit', {
      values: {},
      error: null,
      sent: false,
    });
  }

  const name = (req.body.name || '').trim();
  const email = (req.body.email || '').trim().toLowerCase();
  const essayUrl = cleanUrl(req.body.essay_url);
  const values = { name, email, essay_url: (req.body.essay_url || '').trim() };

  if (!name) {
    return res.status(400).render('submit', { values, sent: false, error: 'Add your name.' });
  }
  if (!looksLikeEmail(email)) {
    return res.status(400).render('submit', {
      values,
      sent: false,
      error: 'That email address does not look right. We need a working one to reply to.',
    });
  }
  if (!essayUrl) {
    return res.status(400).render('submit', {
      values,
      sent: false,
      error: 'The link needs to be a full web address, starting with http:// or https://',
    });
  }

  db.prepare('INSERT INTO submissions (name, email, essay_url) VALUES (?, ?, ?)').run(
    name,
    email,
    essayUrl
  );

  res.render('submit', { values: {}, error: null, sent: true });
});

module.exports = router;
