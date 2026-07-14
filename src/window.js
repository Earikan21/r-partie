// The submission window.
//
// The owner sets three dates and a mode. Everything else — whether the form
// accepts a POST, what the site says about it — is derived from here, so the
// window opens and closes on its own.

const TZ = process.env.SITE_TZ || 'America/Los_Angeles';

/** Today where the magazine lives, as YYYY-MM-DD. */
function today() {
  // en-CA formats as YYYY-MM-DD, which sorts and compares as a plain string.
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ });
}

/** "2026-04-15" -> "April 15, 2026". Parsed as UTC so it never slips a day. */
function longDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * @returns {{ state: 'open'|'upcoming'|'closed', isOpen: boolean,
 *             sentence: string, opensOn: string, closesOn: string, replyBy: string }}
 */
function submissionWindow(settings, now = today()) {
  const opens = settings.submissions_opens_on || '';
  const closes = settings.submissions_closes_on || '';
  const reply = settings.submissions_reply_by || '';
  const mode = settings.submissions_mode || 'scheduled';

  const base = { opensOn: opens, closesOn: closes, replyBy: reply };
  const hear = reply ? ` You will hear by ${longDate(reply)}.` : '';

  if (mode === 'open') {
    return { ...base, state: 'open', isOpen: true, sentence: 'Submissions are open.' + hear };
  }
  if (mode === 'closed') {
    return {
      ...base,
      state: 'closed',
      isOpen: false,
      sentence: settings.submissions_closed_notice,
    };
  }

  // mode === 'scheduled'
  if (!opens && !closes) {
    // No dates set. Stay shut rather than quietly accept work nobody will read.
    return {
      ...base,
      state: 'closed',
      isOpen: false,
      sentence: settings.submissions_closed_notice,
    };
  }

  if (opens && now < opens) {
    const until = closes ? ` until ${longDate(closes)}` : '';
    return {
      ...base,
      state: 'upcoming',
      isOpen: false,
      sentence: `Submissions open on ${longDate(opens)}${until}.` + hear,
    };
  }

  if (closes && now > closes) {
    return {
      ...base,
      state: 'closed',
      isOpen: false,
      sentence: settings.submissions_closed_notice,
    };
  }

  // We are inside the window.
  const until = closes ? ` until ${longDate(closes)}` : '';
  const from = opens ? ` from ${longDate(opens)}` : '';
  return {
    ...base,
    state: 'open',
    isOpen: true,
    sentence: `Submissions are open${from}${until}.` + hear,
  };
}

module.exports = { submissionWindow, today, longDate, TZ };
