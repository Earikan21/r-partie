const { db } = require('./db');
const { domainOf } = require('./email');

/**
 * A pattern is either one address — `nuisance@example.com` — or a whole domain,
 * written `@example.com`. A bare domain is taken to mean the domain.
 */
function normalize(raw) {
  const pattern = (raw || '').trim().toLowerCase();
  if (!pattern) return '';
  if (pattern.includes('@')) return pattern.startsWith('@') ? pattern : pattern;
  return '@' + pattern; // "spam.com" means "@spam.com"
}

function isDomainPattern(pattern) {
  return pattern.startsWith('@');
}

/** Is this address blocked, and by which rule? */
function blockFor(email) {
  const address = (email || '').trim().toLowerCase();
  if (!address) return null;

  const exact = db.prepare('SELECT * FROM blocked WHERE pattern = ?').get(address);
  if (exact) return exact;

  const domain = '@' + domainOf(address);
  return db.prepare('SELECT * FROM blocked WHERE pattern = ?').get(domain) || null;
}

function addBlock(raw, note, ownerId) {
  const pattern = normalize(raw);
  if (!pattern) return { error: 'Nothing to block.' };

  // "@example.com" is fine; "nuisance@example.com" is fine; "@" alone is not.
  const body = pattern.replace(/^@/, '');
  if (!body.includes('.') || body.startsWith('.') || body.endsWith('.')) {
    return { error: 'That is not an address or a domain.' };
  }

  if (db.prepare('SELECT id FROM blocked WHERE pattern = ?').get(pattern)) {
    return { error: `${pattern} is already blocked.` };
  }

  db.prepare('INSERT INTO blocked (pattern, note, created_by) VALUES (?, ?, ?)').run(
    pattern,
    (note || '').trim(),
    ownerId
  );
  return { pattern };
}

function removeBlock(id) {
  db.prepare('DELETE FROM blocked WHERE id = ?').run(id);
}

function blocklist() {
  return db
    .prepare(
      `SELECT b.*, o.name AS blocked_by
       FROM blocked b
       LEFT JOIN owners o ON o.id = b.created_by
       ORDER BY b.created_at DESC`
    )
    .all()
    .map((row) => ({ ...row, is_domain: isDomainPattern(row.pattern) }));
}

module.exports = { normalize, blockFor, addBlock, removeBlock, blocklist };
