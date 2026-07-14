const crypto = require('crypto');
const { db } = require('./db');

const INVITE_DAYS = 7;

/** Mint an invite. Any earlier unused invite to the same address is torn up. */
function createInvite(email, invitedBy) {
  const token = crypto.randomBytes(24).toString('base64url');
  db.prepare('DELETE FROM invites WHERE email = ? AND accepted_at IS NULL').run(email);
  db.prepare(
    `INSERT INTO invites (email, token, invited_by, expires_at)
     VALUES (?, ?, ?, datetime('now', '+${INVITE_DAYS} days'))`
  ).run(email, token, invitedBy);
  return db.prepare('SELECT * FROM invites WHERE token = ?').get(token);
}

/** The invite behind a token, only if it is still good. Expiry is decided by SQLite. */
function findValidInvite(token) {
  if (!token) return null;
  return (
    db
      .prepare(
        `SELECT * FROM invites
         WHERE token = ? AND accepted_at IS NULL AND expires_at > datetime('now')`
      )
      .get(token) || null
  );
}

/** Everything still outstanding, newest first. Expired ones are shown as expired. */
function pendingInvites() {
  return db
    .prepare(
      `SELECT i.*,
              (i.expires_at <= datetime('now')) AS is_expired,
              o.name AS invited_by_name
       FROM invites i
       LEFT JOIN owners o ON o.id = i.invited_by
       WHERE i.accepted_at IS NULL
       ORDER BY i.created_at DESC`
    )
    .all();
}

/** The invite link, built from the request so it is right in dev and in production. */
function inviteUrl(req, token) {
  return `${req.protocol}://${req.get('host')}/invite/${token}`;
}

module.exports = { createInvite, findValidInvite, pendingInvites, inviteUrl, INVITE_DAYS };
