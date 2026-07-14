const { db } = require('./db');

const MAX_DEPTH = 4; // top level is 0, so five tiers of indent at the very most
const MAX_NAME = 40;
const MAX_BODY = 2000;

/** Every reply on an issue, assembled into a tree. One query, not one per level. */
function commentTree(issueId) {
  const rows = db
    .prepare('SELECT * FROM comments WHERE issue_id = ? ORDER BY created_at, id')
    .all(issueId);

  const byId = new Map();
  for (const row of rows) byId.set(row.id, { ...row, children: [] });

  const roots = [];
  for (const node of byId.values()) {
    const parent = node.parent_id ? byId.get(node.parent_id) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

function countComments(issueId) {
  return db.prepare('SELECT COUNT(*) AS n FROM comments WHERE issue_id = ?').get(issueId).n;
}

module.exports = { commentTree, countComments, MAX_DEPTH, MAX_NAME, MAX_BODY };
