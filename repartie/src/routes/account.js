const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { requireOwner } = require('../middleware');

const router = express.Router();
router.use('/account', requireOwner);

const looksLikeEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const render = (res, status, extra = {}) =>
  res.status(status).render('account', {
    error: null,
    ok: null,
    values: {},
    ...extra,
  });

router.get('/account', (req, res) => render(res, 200));

/** Your name and the address you sign in with. */
router.post('/account/details', (req, res) => {
  const name = (req.body.name || '').trim();
  const email = (req.body.email || '').trim().toLowerCase();
  const values = { name, email };

  if (!name) return render(res, 400, { error: 'You need a name.', values });
  if (!looksLikeEmail(email)) {
    return render(res, 400, { error: 'That is not an email address.', values });
  }

  const taken = db.prepare('SELECT id FROM owners WHERE email = ? AND id != ?')
    .get(email, res.locals.owner.id);
  if (taken) return render(res, 400, { error: 'Another owner already uses that address.', values });

  db.prepare('UPDATE owners SET name = ?, email = ? WHERE id = ?')
    .run(name, email, res.locals.owner.id);

  req.session.flash = { type: 'ok', message: 'Saved. Sign in with the new address from now on.' };
  res.redirect('/account');
});

/** Always available, to everyone, forever. */
router.post('/account/password', (req, res) => {
  const current = req.body.current || '';
  const password = req.body.password || '';
  const confirm = req.body.confirm || '';

  const owner = db.prepare('SELECT * FROM owners WHERE id = ?').get(res.locals.owner.id);

  if (!bcrypt.compareSync(current, owner.password_hash)) {
    return render(res, 400, { error: 'That is not your current password.' });
  }
  if (password.length < 10) {
    return render(res, 400, { error: 'The new password needs at least 10 characters.' });
  }
  if (password !== confirm) {
    return render(res, 400, { error: 'The two new passwords do not match.' });
  }
  if (password === current) {
    return render(res, 400, { error: 'That is the password you already have.' });
  }

  db.prepare('UPDATE owners SET password_hash = ?, must_change_password = 0 WHERE id = ?')
    .run(bcrypt.hashSync(password, 10), owner.id);

  req.session.flash = { type: 'ok', message: 'Password changed.' };
  res.redirect(owner.must_change_password ? '/admin' : '/account');
});

module.exports = router;
