const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { findValidInvite } = require('../invites');

const router = express.Router();

const GONE = {
  title: 'That invitation is no good',
  message:
    'It may have been used already, torn up, or simply run out. Ask whoever sent it for a fresh one.',
};

router.get('/invite/:token', (req, res) => {
  const invite = findValidInvite(req.params.token);
  if (!invite) return res.status(410).render('error', GONE);

  res.render('invite', { invite, values: {}, error: null });
});

router.post('/invite/:token', (req, res) => {
  const invite = findValidInvite(req.params.token);
  if (!invite) return res.status(410).render('error', GONE);

  const name = (req.body.name || '').trim();
  const password = req.body.password || '';
  const confirm = req.body.confirm || '';
  const values = { name };

  const fail = (error) => res.status(400).render('invite', { invite, values, error });

  if (!name) return fail('Give us a name to put on the masthead.');
  if (password.length < 10) return fail('Passwords need at least 10 characters.');
  if (password !== confirm) return fail('The two passwords do not match.');

  // Someone could have been made an owner by other means since the invite went out.
  if (db.prepare('SELECT id FROM owners WHERE email = ?').get(invite.email)) {
    return res.status(409).render('error', {
      title: 'You are already an owner',
      message: 'There is an account on that email. Sign in instead.',
    });
  }

  // Claim the invite and open the account in one go, so a crash between the two
  // cannot leave the invite spent with no owner behind it.
  const accept = db.transaction(() => {
    const info = db
      .prepare('INSERT INTO owners (name, email, password_hash) VALUES (?, ?, ?)')
      .run(name, invite.email, bcrypt.hashSync(password, 10));
    db.prepare("UPDATE invites SET accepted_at = datetime('now') WHERE id = ?").run(invite.id);
    return info.lastInsertRowid;
  });

  const ownerId = accept();

  req.session.ownerId = ownerId;
  req.session.flash = { type: 'ok', message: `Welcome, ${name}. This is the desk.` };
  res.redirect('/admin');
});

module.exports = router;
