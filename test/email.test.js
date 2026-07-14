// Unit tests for the email checks. Run: node test/email.test.js
// The resolver is stubbed, so these do not touch the network and cannot flake.
const assert = require('assert');
const { looksLikeEmail, domainTakesMail } = require('../src/email');

let pass = 0;
const it = async (name, fn) => {
  try {
    await fn();
    console.log('  ok    ' + name);
    pass++;
  } catch (err) {
    console.log('  FAIL  ' + name + '\n        ' + err.message);
    process.exitCode = 1;
  }
};

/** A fake DNS that answers however the test wants. */
const resolverThat = (mx, a) => ({
  resolveMx: async () => {
    if (mx instanceof Error) throw mx;
    return mx;
  },
  resolve4: async () => {
    if (a instanceof Error) throw a;
    return a;
  },
});
const err = (code) => Object.assign(new Error(code), { code });

(async () => {
  console.log('looksLikeEmail');

  await it('accepts an ordinary address', () => {
    assert.equal(looksLikeEmail('iris@example.org'), true);
  });
  await it('rejects nonsense', () => {
    assert.equal(looksLikeEmail('nonsense'), false);
    assert.equal(looksLikeEmail('no@domain'), false);
    assert.equal(looksLikeEmail(''), false);
  });

  console.log('\ndomainTakesMail');

  await it('accepts a domain with a mail server', async () => {
    const r = await domainTakesMail('a@good.com', resolverThat([{ exchange: 'mx.good.com' }]));
    assert.equal(r.ok, true);
  });

  await it('rejects a null MX — the domain saying it takes no mail', async () => {
    const r = await domainTakesMail('a@example.com', resolverThat([{ exchange: '' }]));
    assert.equal(r.ok, false);
    assert.match(r.reason, /does not accept mail/);
  });

  await it('rejects a domain that does not exist', async () => {
    const r = await domainTakesMail('a@nope.invalid', resolverThat(err('ENOTFOUND'), err('ENOTFOUND')));
    assert.equal(r.ok, false);
  });

  await it('accepts no-MX when the domain still resolves — mail falls back to the A record', async () => {
    const r = await domainTakesMail('a@quirky.com', resolverThat(err('ENODATA'), ['203.0.113.1']));
    assert.equal(r.ok, true);
  });

  await it('FAILS OPEN when the resolver is having a bad day', async () => {
    // A flaky resolver must never cost us an essay.
    const r = await domainTakesMail('a@real.com', resolverThat(err('ESERVFAIL')));
    assert.equal(r.ok, true);
  });

  await it('fails open on a timeout too', async () => {
    const hangs = { resolveMx: () => new Promise(() => {}) };
    const r = await domainTakesMail('a@slow.com', hangs);
    assert.equal(r.ok, true);
  });

  console.log(`\n${pass} unit checks passed`);
})();
