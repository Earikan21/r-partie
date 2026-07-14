# Repartie

A newsletter of essays. Readers read; the owner runs the place. There is no third role.

Node + Express + EJS + SQLite. No build step, no framework, no JavaScript shipped to the
reader. Deploys to Render from GitHub.

---

## Run it

```bash
npm install
cp .env.example .env      # then edit it
npm run dev               # http://localhost:3000
```

The first boot creates one owner account from `OWNER_EMAIL` / `OWNER_PASSWORD` and prints
it to the console. Sign in at `/login`. Everything else is built from the site itself.

```bash
npm test                  # 10 unit checks on the date logic, 53 end-to-end
```

---

## The two views

**Reader.** No account, ever. They read every issue we have published, past and present,
and they can send in an essay when the window is open. That is the whole surface.

**Owner.** One login, at `/login`, leading to `/admin`. Owners read submissions, set their
status, build issues, publish them, rewrite every word on the public site, and add other
owners. There is no "editor" tier — an owner is an owner.

---

## Submissions

Three fields: **name, email, link to the essay.** No account, no file upload. The link is
validated as a real `http(s)` URL before it is stored, so nothing hostile ends up in an
`href` on the owner's screen.

`/admin` is a table of every submission — name, email, the link, the date it arrived, a
status stamp, a status selector, and a notes field only the owner sees. Statuses are
**pending**, **approved**, **rescinded**. An approved submission grows a "File in an issue"
link, which carries the author and the URL into the piece form so nothing is retyped.

**Nobody is emailed.** Not the writer, not the owner. Approving a submission changes a
status in a table; writing to the author is still a human job. The site says so out loud,
on the table and on the submit page. This is the first thing to build next.

## The window

The owner sets three dates at `/admin/settings`:

> Submissions are open from **March 1** until **April 15**. You will hear by **May 1**.

and the site opens and closes on its own. Before the open date the form is hidden and the
page says when it opens. After the closing date it is hidden again. There is nothing to
remember to switch off.

The window is enforced on the server, not just in the template: a POST into a closed window
is refused with a 403, so a page left open in a tab overnight cannot sneak one through.

`submissions_mode` overrides the dates when you need it to — **always open**, **always
closed**, or **follow the dates**. With no dates set at all, the window stays shut, on the
theory that it is better to turn work away than to accept work nobody is reading.

Dates are compared in `SITE_TZ` (default `America/Los_Angeles`), not in the server's UTC, so
the window turns over at midnight where the magazine actually lives. The tricky cases —
opens on the open date, still open on the closing date, shut the day after, no day-slip
across a month boundary — are pinned down in `test/window.test.js`.

## Issues

An issue has a number, a title, a dateline, an introduction, and pieces. A piece is either
a **link out** to where the essay lives, or **text hosted here** — paste a body and it gets
its own page; leave the body empty and the title links away.

Issues are drafts until published. A draft is invisible to readers and 404s if guessed.
Publishing puts it on the home page and in Past & Present; unpublishing takes it back.

## Site copy

Every heading, label, tagline, and paragraph on the public site lives in the `settings`
table and is editable at `/admin/settings`. No code, no redeploy.

To add another editable string: add the key to `DEFAULT_SETTINGS` in `src/db.js`, add it to
a group in `GROUPS` in `src/routes/admin.js`, and use `settings.your_key` in a template.
Three lines, and it appears in the admin form on its own.

---

## Deploying to Render

Push to GitHub, then **New → Blueprint** and point it at the repo. `render.yaml` does the
rest. Set `OWNER_EMAIL` and `OWNER_PASSWORD` in the dashboard; `SESSION_SECRET` is generated
for you.

**The disk is the thing to get right.** Submissions live in a SQLite file on a persistent
disk at `/var/data`. Persistent disks need a **paid instance** (~$7/month). On the free tier
the filesystem is wiped on every deploy and **every submission you have received will
disappear**. If that is not acceptable, move to Postgres before launch — everything that
touches the database is in `src/db.js` and the four route files, so the swap is contained.

---

## Not built yet

Named honestly, so nobody discovers them in production:

- **Email.** Nothing is sent, to anyone, ever. See above.
- **Password reset.** An owner sets another owner's first password and sends it to them.
  Forgetting it means editing the database.
- **CSRF tokens.** Sessions are `SameSite=Lax`, which stops the ordinary cross-site POST,
  but real tokens are the right answer before this takes anything valuable.
- **Rate limiting.** The submission form is public and unauthenticated. One determined
  script could fill the table. Put Cloudflare or a rate limiter in front of `/submit`.
- **Spam filtering.** No honeypot, no captcha. Watch the table for a week and see.
- **Reordering pieces by dragging.** There is a numeric "order" field instead.

---

## The look

Black, white, and one blue. Nothing else.

The type is after the jacket of Joan Didion's *The White Album* (Simon & Schuster, 1979;
jacket by Robert Anthony), which was set in **Pistilli Roman** — a fat Didone from 1964 with
hairline thins, cut so tight that the elongated J's ball terminal doubles as the dot on the
i below. The book's interior was Palatino.

Pistilli is not free, so:

- **Bodoni Moda**, weight 900, tracked tight — the closest free stand-in for Pistilli. The
  masthead, the headings, the issue numbers.
- **Spectral** for reading, with **Palatino itself** as the first system fallback, so anyone
  who has it gets the real thing.
- **Courier Prime** for the owner's desk. Submissions arrive as manuscripts, and manuscripts
  are typed.

The devices are period-correct: a double rule under the masthead (heavy black, hairline
blue), contents pages with leader dots, statuses stamped in brackets like a returned
manuscript. It is all in one file — `public/styles.css` — and the palette is four CSS
variables at the top.
