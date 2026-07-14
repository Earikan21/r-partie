// Unit tests for the submission window. Run: node test/window.test.js
const assert = require('assert');
const { submissionWindow } = require('../src/window');

const base = {
  submissions_mode: 'scheduled',
  submissions_opens_on: '',
  submissions_closes_on: '',
  submissions_reply_by: '',
  submissions_closed_notice: 'We are not reading right now.',
};

const w = (over, now) => submissionWindow({ ...base, ...over }, now);
let pass = 0;
const it = (name, fn) => {
  try {
    fn();
    console.log('  ok    ' + name);
    pass++;
  } catch (err) {
    console.log('  FAIL  ' + name + '\n        ' + err.message);
    process.exitCode = 1;
  }
};

console.log('submissionWindow');

it('is closed when no dates are set', () => {
  assert.equal(w({}, '2026-07-14').state, 'closed');
  assert.equal(w({}, '2026-07-14').isOpen, false);
});

it('is upcoming before the open date', () => {
  const r = w(
    { submissions_opens_on: '2026-09-01', submissions_closes_on: '2026-10-15' },
    '2026-08-31'
  );
  assert.equal(r.state, 'upcoming');
  assert.equal(r.isOpen, false);
  assert.match(r.sentence, /open on September 1, 2026 until October 15, 2026/);
});

it('opens on the open date itself', () => {
  const r = w(
    { submissions_opens_on: '2026-09-01', submissions_closes_on: '2026-10-15' },
    '2026-09-01'
  );
  assert.equal(r.state, 'open');
  assert.equal(r.isOpen, true);
});

it('is still open on the closing date itself', () => {
  const r = w(
    { submissions_opens_on: '2026-09-01', submissions_closes_on: '2026-10-15' },
    '2026-10-15'
  );
  assert.equal(r.isOpen, true);
});

it('shuts the day after the closing date', () => {
  const r = w(
    { submissions_opens_on: '2026-09-01', submissions_closes_on: '2026-10-15' },
    '2026-10-16'
  );
  assert.equal(r.state, 'closed');
  assert.equal(r.isOpen, false);
  assert.equal(r.sentence, 'We are not reading right now.');
});

it('promises a reply-by date when one is set', () => {
  const r = w(
    {
      submissions_opens_on: '2026-09-01',
      submissions_closes_on: '2026-10-15',
      submissions_reply_by: '2026-11-30',
    },
    '2026-09-10'
  );
  assert.match(r.sentence, /You will hear by November 30, 2026\./);
});

it('handles an open date with no closing date', () => {
  const r = w({ submissions_opens_on: '2026-01-01' }, '2026-07-14');
  assert.equal(r.isOpen, true);
  assert.ok(!r.sentence.includes('until'));
});

it('honours the always-open override', () => {
  const r = w(
    { submissions_mode: 'open', submissions_closes_on: '2020-01-01' },
    '2026-07-14'
  );
  assert.equal(r.isOpen, true);
});

it('honours the always-closed override', () => {
  const r = w(
    {
      submissions_mode: 'closed',
      submissions_opens_on: '2026-01-01',
      submissions_closes_on: '2026-12-31',
    },
    '2026-07-14'
  );
  assert.equal(r.isOpen, false);
});

it('does not slip a day across a month boundary', () => {
  const r = w({ submissions_opens_on: '2026-03-01' }, '2026-02-28');
  assert.equal(r.state, 'upcoming');
  assert.match(r.sentence, /March 1, 2026/);
});

console.log(`\n${pass} unit checks passed`);
