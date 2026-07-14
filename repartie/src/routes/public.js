const express = require('express');
const { db } = require('../db');

const router = express.Router();

const publishedIssues = () =>
  db
    .prepare('SELECT * FROM issues WHERE is_published = 1 ORDER BY number DESC')
    .all();

const piecesIn = (issueId) =>
  db
    .prepare('SELECT * FROM pieces WHERE issue_id = ? ORDER BY position, id')
    .all(issueId);

router.get('/', (req, res) => {
  const issues = publishedIssues();
  const current = issues[0] || null;
  res.render('home', {
    current,
    pieces: current ? piecesIn(current.id) : [],
    back: issues.slice(1, 4),
  });
});

// Past and present, all in one place.
router.get('/issues', (req, res) => {
  const issues = publishedIssues().map((issue) => ({
    ...issue,
    pieces: piecesIn(issue.id),
  }));
  res.render('issues', { issues });
});

router.get('/issues/:slug', (req, res) => {
  const issue = db
    .prepare('SELECT * FROM issues WHERE slug = ? AND is_published = 1')
    .get(req.params.slug);
  if (!issue) {
    return res.status(404).render('error', {
      title: 'No such issue',
      message: 'That issue is not here. The archive has everything we have run.',
    });
  }
  res.render('issue', { issue, pieces: piecesIn(issue.id) });
});

// A piece hosted on the site rather than linked out.
router.get('/issues/:slug/:piece', (req, res) => {
  const issue = db
    .prepare('SELECT * FROM issues WHERE slug = ? AND is_published = 1')
    .get(req.params.slug);
  const piece = issue
    ? db
        .prepare('SELECT * FROM pieces WHERE issue_id = ? AND slug = ?')
        .get(issue.id, req.params.piece)
    : null;

  if (!piece || !piece.body) {
    return res.status(404).render('error', {
      title: 'Not here',
      message: 'That essay is not hosted on this site.',
    });
  }
  res.render('piece', { issue, piece });
});

router.get('/about', (req, res) => {
  res.render('about');
});

module.exports = router;
