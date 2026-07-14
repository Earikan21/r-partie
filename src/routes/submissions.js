const express = require('express');
const { db } = require('../db');
const { looksLikeEmail, domainTakesMail } = require('../email');
const { blockFor } = require('../blocklist');

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

router.get('/submit', (req, res) => {
  res.render('submit', { values: {}, error: null, sent: false });
});

router.post('/submit', async (req, res, next) => {
  try {
    // The window decides, not the form. A stale page cannot post into a closed window.
    if (!res.locals.window.isOpen) {
      return res.status(403).render('submit', { values: {}, error: null, sent: false });
    }

    const name = (req.body.name || '').trim();
    const email = (req.body.email || '').trim().toLowerCase();
    const essayUrl = cleanUrl(req.body.essay_url);
    const values = { name, email, essay_url: (req.body.essay_url || '').trim() };

    const refuse = (status, error) =>
      res.status(status).render('submit', { values, sent: false, error });

    if (!name) return refuse(400, 'Add your name.');

    if (!looksLikeEmail(email)) {
      return refuse(400, 'That email address does not look right. We need a working one to reply to.');
    }

    // Blocked before anything expensive happens.
    if (blockFor(email)) {
      return refuse(403, res.locals.settings.submissions_blocked_notice);
    }

    if (!essayUrl) {
      return refuse(400, 'The link needs to be a full web address, starting with http:// or https://');
    }

    // Can that domain actually take delivery? Fails open — see src/email.js.
    const mail = await domainTakesMail(email);
    if (!mail.ok) {
      return refuse(400, `We cannot write back to that address — ${mail.reason}. Check the spelling.`);
    }

    db.prepare('INSERT INTO submissions (name, email, essay_url) VALUES (?, ?, ?)').run(
      name,
      email,
      essayUrl
    );

    res.render('submit', { values: {}, error: null, sent: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
