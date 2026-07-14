const express = require('express');
const { db, DEFAULT_SETTINGS } = require('../db');
const { requireOwner, setSetting, slugify } = require('../middleware');
const { today } = require('../window');
const { createInvite, pendingInvites, inviteUrl, INVITE_DAYS } = require('../invites');
const { addBlock, removeBlock, blocklist } = require('../blocklist');

const router = express.Router();
router.use(requireOwner);

// Nobody reaches the desk on the standard credentials.
router.use((req, res, next) => {
  if (res.locals.owner.must_change_password) {
    req.session.flash = {
      type: 'error',
      message: 'Set your own email and password before you start.',
    };
    return res.redirect('/account');
  }
  next();
});

const STATUSES = ['pending', 'approved', 'rescinded'];

// --- The desk: every submission, with its link and its status ------------

router.get('/', (req, res) => {
  const filter = STATUSES.includes(req.query.status) ? req.query.status : null;
  const submissions = filter
    ? db
        .prepare('SELECT * FROM submissions WHERE status = ? ORDER BY created_at DESC')
        .all(filter)
    : db.prepare('SELECT * FROM submissions ORDER BY created_at DESC').all();

  const counts = { pending: 0, approved: 0, rescinded: 0 };
  for (const row of db
    .prepare('SELECT status, COUNT(*) AS n FROM submissions GROUP BY status')
    .all()) {
    counts[row.status] = row.n;
  }

  res.render('admin/submissions', {
    submissions,
    counts,
    filter,
    statuses: STATUSES,
    total: counts.pending + counts.approved + counts.rescinded,
  });
});

router.post('/submissions/:id', (req, res) => {
  const status = STATUSES.includes(req.body.status) ? req.body.status : 'pending';
  db.prepare(
    "UPDATE submissions SET status = ?, owner_notes = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(status, (req.body.owner_notes || '').trim(), req.params.id);
  req.session.flash = { type: 'ok', message: 'Submission updated.' };
  res.redirect(req.get('referer') || '/admin');
});

router.post('/submissions/:id/delete', (req, res) => {
  db.prepare('DELETE FROM submissions WHERE id = ?').run(req.params.id);
  req.session.flash = { type: 'ok', message: 'Submission deleted.' };
  res.redirect('/admin');
});

// --- The blocklist -------------------------------------------------------

router.get('/blocked', (req, res) => {
  res.render('admin/blocked', { blocked: blocklist(), error: null });
});

router.post('/blocked', (req, res) => {
  const result = addBlock(req.body.pattern, req.body.note, res.locals.owner.id);

  if (result.error) {
    return res.status(400).render('admin/blocked', { blocked: blocklist(), error: result.error });
  }

  req.session.flash = { type: 'ok', message: `${result.pattern} is blocked.` };
  res.redirect('/admin/blocked');
});

router.post('/blocked/:id/delete', (req, res) => {
  removeBlock(req.params.id);
  req.session.flash = { type: 'ok', message: 'Unblocked.' };
  res.redirect('/admin/blocked');
});

// Straight from the table: block the sender of this submission.
router.post('/submissions/:id/block', (req, res) => {
  const submission = db.prepare('SELECT * FROM submissions WHERE id = ?').get(req.params.id);
  if (!submission) return res.sendStatus(404);

  const target = req.body.scope === 'domain'
    ? '@' + submission.email.split('@')[1]
    : submission.email;

  const result = addBlock(target, `Blocked from the table — ${submission.name}`, res.locals.owner.id);

  req.session.flash = result.error
    ? { type: 'error', message: result.error }
    : { type: 'ok', message: `${result.pattern} is blocked. Nothing more arrives from there.` };

  res.redirect('/admin');
});

// --- Issues --------------------------------------------------------------

router.get('/issues', (req, res) => {
  const issues = db
    .prepare(
      `SELECT i.*, (SELECT COUNT(*) FROM pieces p WHERE p.issue_id = i.id) AS piece_count
       FROM issues i ORDER BY i.number DESC`
    )
    .all();

  // Arriving from an approved submission, on the way to filing it in an issue.
  const from = req.query.from
    ? db.prepare('SELECT * FROM submissions WHERE id = ?').get(req.query.from)
    : null;

  const nextNumber = (db.prepare('SELECT MAX(number) AS n FROM issues').get().n || 0) + 1;
  res.render('admin/issues', { issues, from, nextNumber });
});

router.post('/issues', (req, res) => {
  const number = parseInt(req.body.number, 10);
  const title = (req.body.title || '').trim();
  if (!Number.isInteger(number) || !title) {
    req.session.flash = { type: 'error', message: 'An issue needs a number and a title.' };
    return res.redirect('/admin/issues');
  }
  if (db.prepare('SELECT id FROM issues WHERE number = ?').get(number)) {
    req.session.flash = { type: 'error', message: `Issue ${number} already exists.` };
    return res.redirect('/admin/issues');
  }

  const info = db
    .prepare('INSERT INTO issues (number, slug, title, dateline) VALUES (?, ?, ?, ?)')
    .run(number, slugify(`no-${number}-${title}`, `issue-${number}`), title,
         (req.body.dateline || '').trim());

  res.redirect('/admin/issues/' + info.lastInsertRowid);
});

router.get('/issues/:id', (req, res) => {
  const issue = db.prepare('SELECT * FROM issues WHERE id = ?').get(req.params.id);
  if (!issue) return res.sendStatus(404);

  const pieces = db
    .prepare('SELECT * FROM pieces WHERE issue_id = ? ORDER BY position, id')
    .all(issue.id);

  const from = req.query.from
    ? db.prepare('SELECT * FROM submissions WHERE id = ?').get(req.query.from)
    : null;

  res.render('admin/issue', { issue, pieces, from });
});

router.post('/issues/:id', (req, res) => {
  const title = (req.body.title || '').trim();
  db.prepare('UPDATE issues SET title = ?, dateline = ?, intro = ? WHERE id = ?').run(
    title,
    (req.body.dateline || '').trim(),
    (req.body.intro || '').trim(),
    req.params.id
  );
  req.session.flash = { type: 'ok', message: 'Issue saved.' };
  res.redirect('/admin/issues/' + req.params.id);
});

router.post('/issues/:id/publish', (req, res) => {
  const publish = req.body.publish === 'yes';
  db.prepare('UPDATE issues SET is_published = ?, published_at = ? WHERE id = ?').run(
    publish ? 1 : 0,
    publish ? today() : null,
    req.params.id
  );
  req.session.flash = {
    type: 'ok',
    message: publish ? 'Issue published. Readers can see it now.' : 'Issue taken down.',
  };
  res.redirect('/admin/issues/' + req.params.id);
});

router.post('/issues/:id/delete', (req, res) => {
  db.prepare('DELETE FROM issues WHERE id = ?').run(req.params.id); // pieces cascade
  req.session.flash = { type: 'ok', message: 'Issue deleted.' };
  res.redirect('/admin/issues');
});

// --- Pieces inside an issue ---------------------------------------------

router.post('/issues/:id/pieces', (req, res) => {
  const issue = db.prepare('SELECT * FROM issues WHERE id = ?').get(req.params.id);
  if (!issue) return res.sendStatus(404);

  const title = (req.body.title || '').trim();
  const author = (req.body.author || '').trim();
  if (!title || !author) {
    req.session.flash = { type: 'error', message: 'A piece needs a title and an author.' };
    return res.redirect('/admin/issues/' + issue.id);
  }

  // Slugs are unique per issue, so two issues can both have "on-the-freeway".
  let slug = slugify(title, 'piece');
  let n = 2;
  while (
    db.prepare('SELECT id FROM pieces WHERE issue_id = ? AND slug = ?').get(issue.id, slug)
  ) {
    slug = slugify(title, 'piece') + '-' + n++;
  }

  const position =
    (db.prepare('SELECT MAX(position) AS p FROM pieces WHERE issue_id = ?').get(issue.id).p || 0) + 1;

  db.prepare(
    `INSERT INTO pieces (issue_id, slug, title, author, url, body, blurb, position)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    issue.id,
    slug,
    title,
    author,
    (req.body.url || '').trim(),
    (req.body.body || '').trim(),
    (req.body.blurb || '').trim(),
    position
  );

  req.session.flash = { type: 'ok', message: 'Piece added.' };
  res.redirect('/admin/issues/' + issue.id);
});

router.post('/pieces/:id', (req, res) => {
  const piece = db.prepare('SELECT * FROM pieces WHERE id = ?').get(req.params.id);
  if (!piece) return res.sendStatus(404);

  db.prepare(
    `UPDATE pieces SET title = ?, author = ?, url = ?, body = ?, blurb = ?, position = ?
     WHERE id = ?`
  ).run(
    (req.body.title || '').trim(),
    (req.body.author || '').trim(),
    (req.body.url || '').trim(),
    (req.body.body || '').trim(),
    (req.body.blurb || '').trim(),
    parseInt(req.body.position, 10) || piece.position,
    piece.id
  );

  req.session.flash = { type: 'ok', message: 'Piece saved.' };
  res.redirect('/admin/issues/' + piece.issue_id);
});

router.post('/pieces/:id/delete', (req, res) => {
  const piece = db.prepare('SELECT issue_id FROM pieces WHERE id = ?').get(req.params.id);
  if (!piece) return res.sendStatus(404);
  db.prepare('DELETE FROM pieces WHERE id = ?').run(req.params.id);
  req.session.flash = { type: 'ok', message: 'Piece removed.' };
  res.redirect('/admin/issues/' + piece.issue_id);
});

// --- Site copy and the submission window ---------------------------------

const LONG_FIELDS = new Set([
  'home_standfirst',
  'about_body',
  'issues_intro',
  'submit_intro',
  'submit_guidelines',
  'submissions_closed_notice',
  'submissions_thanks',
]);

const DATE_FIELDS = new Set([
  'submissions_opens_on',
  'submissions_closes_on',
  'submissions_reply_by',
]);

const GROUPS = [
  {
    label: 'The submission window',
    note: 'Set the dates and the site opens and closes on its own.',
    keys: [
      'submissions_mode',
      'submissions_opens_on',
      'submissions_closes_on',
      'submissions_reply_by',
      'submissions_closed_notice',
      'submissions_thanks',
      'submissions_blocked_notice',
    ],
  },
  { label: 'Masthead', keys: ['site_title', 'site_tagline', 'footer_text', 'footer_credit'] },
  { label: 'Navigation', keys: ['nav_issues', 'nav_about', 'nav_submit'] },
  { label: 'Home', keys: ['home_heading', 'home_standfirst'] },
  { label: 'Past & Present', keys: ['issues_heading', 'issues_intro'] },
  { label: 'About', keys: ['about_heading', 'about_body'] },
  { label: 'Submit', keys: ['submit_heading', 'submit_intro', 'submit_guidelines'] },
];

router.get('/settings', (req, res) => {
  res.render('admin/settings', { groups: GROUPS, longFields: LONG_FIELDS, dateFields: DATE_FIELDS });
});

router.post('/settings', (req, res) => {
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (typeof req.body[key] === 'string') setSetting(key, req.body[key].trim());
  }
  req.session.flash = { type: 'ok', message: 'Saved. The public site has changed.' };
  res.redirect('/admin/settings');
});

router.post('/settings/reset', (req, res) => {
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) setSetting(key, value);
  req.session.flash = { type: 'ok', message: 'Everything is back to the defaults.' };
  res.redirect('/admin/settings');
});

// --- The other owners ----------------------------------------------------

router.get('/people', (req, res) => {
  const owners = db
    .prepare('SELECT id, name, email, created_at FROM owners ORDER BY created_at')
    .all();
  res.render('admin/people', {
    owners,
    invites: pendingInvites(),
    inviteUrl: (token) => inviteUrl(req, token),
    inviteDays: INVITE_DAYS,
    error: null,
  });
});

router.post('/people/invite', (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();

  const fail = (error) =>
    res.status(400).render('admin/people', {
      owners: db.prepare('SELECT id, name, email, created_at FROM owners ORDER BY created_at').all(),
      invites: pendingInvites(),
      inviteUrl: (token) => inviteUrl(req, token),
      inviteDays: INVITE_DAYS,
      error,
    });

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('That is not an email address.');
  if (db.prepare('SELECT id FROM owners WHERE email = ?').get(email)) {
    return fail('Somebody with that email is already an owner.');
  }

  const invite = createInvite(email, res.locals.owner.id);
  req.session.flash = {
    type: 'ok',
    message: `Invitation ready for ${email}. Copy the link below and send it to them.`,
  };
  res.redirect('/admin/people#invite-' + invite.id);
});

router.post('/people/invite/:id/revoke', (req, res) => {
  db.prepare('DELETE FROM invites WHERE id = ? AND accepted_at IS NULL').run(req.params.id);
  req.session.flash = { type: 'ok', message: 'Invitation torn up. The link is dead.' };
  res.redirect('/admin/people');
});

router.post('/people/:id/delete', (req, res) => {
  const count = db.prepare('SELECT COUNT(*) AS n FROM owners').get().n;
  if (count <= 1) {
    req.session.flash = { type: 'error', message: 'Repartie needs at least one owner.' };
    return res.redirect('/admin/people');
  }
  if (Number(req.params.id) === res.locals.owner.id) {
    req.session.flash = { type: 'error', message: 'You cannot remove yourself.' };
    return res.redirect('/admin/people');
  }
  db.prepare('DELETE FROM owners WHERE id = ?').run(req.params.id);
  req.session.flash = { type: 'ok', message: 'Owner removed.' };
  res.redirect('/admin/people');
});

module.exports = router;
