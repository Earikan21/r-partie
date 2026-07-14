// What can and cannot be checked about a stranger's email address.
//
// Syntax is free. Whether the *domain* can receive mail is a DNS lookup away, and it
// catches typos (gmial.com), invented domains, and domains that publish a "null MX"
// record to say they take no mail at all (example.com does this).
//
// What none of this can tell you is whether the *mailbox* exists, or whether the person
// typing it owns it. Only a confirmation email proves that, and this site sends no mail.
// So: reject what is provably undeliverable, accept the rest, and let the owner block
// anyone who turns out to be a nuisance.

const dns = require('dns').promises;

const OFF = process.env.VALIDATE_MX === 'off';
const TIMEOUT_MS = 3000;

function looksLikeEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value || '');
}

function domainOf(email) {
  return (email || '').split('@')[1]?.toLowerCase() || '';
}

const withTimeout = (promise) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('ETIMEOUT')), TIMEOUT_MS)),
  ]);

/**
 * Can this domain take delivery?
 *
 * Fails open on purpose. A resolver hiccup must never cost us an essay — a false
 * rejection loses a writer for good, while a false acceptance costs one row in a table.
 * Only a definite answer ("no such domain", "this domain refuses mail") is a rejection.
 *
 * @returns {Promise<{ ok: boolean, reason: string }>}
 */
async function domainTakesMail(email, resolver = dns) {
  if (OFF) return { ok: true, reason: 'checking is switched off' };

  const domain = domainOf(email);
  if (!domain) return { ok: false, reason: 'no domain' };

  try {
    const records = await withTimeout(resolver.resolveMx(domain));

    // RFC 7505: a single empty exchange is the domain saying "we take no mail".
    const usable = records.filter((r) => r.exchange && r.exchange !== '.');
    if (usable.length) return { ok: true, reason: 'has a mail server' };

    return { ok: false, reason: 'that domain does not accept mail' };
  } catch (err) {
    // No MX is not fatal — mail may still fall back to the domain's A record.
    if (err.code === 'ENODATA' || err.code === 'ENOTFOUND') {
      try {
        const addresses = await withTimeout(resolver.resolve4(domain));
        if (addresses.length) return { ok: true, reason: 'no MX, but the domain resolves' };
      } catch {
        /* fall through */
      }
      return { ok: false, reason: 'we cannot find a mail server for that domain' };
    }

    // ESERVFAIL, timeouts, a resolver that is having a bad day. Let it through.
    return { ok: true, reason: 'could not check — letting it through' };
  }
}

module.exports = { looksLikeEmail, domainOf, domainTakesMail };
