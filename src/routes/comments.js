const express = require('express');
const { db } = require('../db');
const { MAX_DEPTH, MAX_NAME, MAX_BODY } = require('../comments');

const router = express.Router();

router.post('/issues/:slug/comments', (req, res) => {
  const issue = db
    .prepare('SELECT * FROM issues WHERE slug = ? AND is_published = 1')
    .get(req.params.slug);

  if (!issue) {
    return res.status(404).render('error', {
      title: 'Not here',
      message: 'That issue does not exist.',
    });
  }

  const back = `/issues/${issue.slug}#replies`;
  const fail = (message) => {
    req.session.flash = { type: 'error', message };
    return res.redirect(back);
  };

  // Switched off in settings, and enforced here, not only in the template.
  if (res.locals.settings.comments_enabled !== 'yes') {
    return res.status(403).render('error', {
      title: 'Replies are closed',
      message: res.locals.settings.comments_closed_notice,
    });
  }

  // A field no person can see. Anything that fills it in is a script; let it think it won.
  if ((req.body.website || '').trim()) return res.redirect(back);

  const name = (req.body.author_name || '').trim();
  const body = (req.body.body || '').trim();

  if (!name) return fail('Put a name to it.');
  if (name.length > MAX_NAME) return fail('That name is too long.');
  if (!body) return fail('The reply is empty.');
  if (body.length > MAX_BODY) return fail('That reply is too long.');

  let parentId = null;
  let depth = 0;

  if (req.body.parent_id) {
    const parent = db
      .prepare('SELECT * FROM comments WHERE id = ? AND issue_id = ?')
      .get(Number(req.body.parent_id), issue.id);

    if (!parent) return fail('That reply is no longer there.');
    if (parent.depth >= MAX_DEPTH) {
      return fail('That thread has gone as deep as it goes. Reply further up.');
    }

    parentId = parent.id;
    depth = parent.depth + 1;
  }

  const info = db
    .prepare(
      `INSERT INTO comments (issue_id, parent_id, author_name, body, depth)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(issue.id, parentId, name, body, depth);

  res.redirect(`/issues/${issue.slug}#c${info.lastInsertRowid}`);
});

module.exports = router;
