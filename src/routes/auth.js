const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db');

const router = express.Router();

router.get('/login', (req, res) => {
  if (res.locals.owner) return res.redirect('/admin');
  res.render('login', { values: {}, error: null, next: req.query.next || '' });
});

router.post('/login', (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const owner = db.prepare('SELECT * FROM owners WHERE email = ?').get(email);

  if (!owner || !bcrypt.compareSync(req.body.password || '', owner.password_hash)) {
    return res.status(401).render('login', {
      values: { email },
      error: 'That email and password do not match an owner account.',
      next: req.body.next || '',
    });
  }

  req.session.ownerId = owner.id;
  res.redirect(req.body.next || '/admin');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

module.exports = router;
