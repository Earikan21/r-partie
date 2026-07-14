#!/usr/bin/env bash
# Boots the app on a scratch database, walks the reader and the owner through
# their whole journey, tears it down.
set -uo pipefail
cd "$(dirname "$0")"

export DATA_DIR=/tmp/repartie-test
export OWNER_EMAIL=owner@repartie.test
export OWNER_PASSWORD=testpassword
export SESSION_SECRET=test
export PORT=3100

rm -rf "$DATA_DIR"
node server.js > /tmp/server.log 2>&1 < /dev/null &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null' EXIT

for _ in $(seq 1 40); do
  curl -sf -o /dev/null http://localhost:$PORT/ && break
  sleep 0.3
done

B=http://localhost:$PORT
PASS=0; FAIL=0
O=/tmp/owner-cookies.txt

check() { # check <label> <expected> <actual>
  if [ "$2" = "$3" ]; then echo "  ok    $1"; PASS=$((PASS+1));
  else echo "  FAIL  $1 — expected $2, got $3"; FAIL=$((FAIL+1)); fi
}
status() { curl -s -o /dev/null -w "%{http_code}" "$@"; }
# Grep a saved file, never a pipe: grep -q exits early, SIGPIPEs curl and trips pipefail.
has() { # has <label> <needle> <curl args...>
  local label="$1" needle="$2"; shift 2
  curl -s -o /tmp/resp.html "$@"
  if grep -qF "$needle" /tmp/resp.html; then echo "  ok    $label"; PASS=$((PASS+1));
  else echo "  FAIL  $label — not in response: $needle"; FAIL=$((FAIL+1)); fi
}
hasnt() {
  local label="$1" needle="$2"; shift 2
  curl -s -o /tmp/resp.html "$@"
  if grep -qF "$needle" /tmp/resp.html; then echo "  FAIL  $label — found: $needle"; FAIL=$((FAIL+1));
  else echo "  ok    $label"; PASS=$((PASS+1)); fi
}
set_window() { # set_window <mode> <opens> <closes> <replyby>
  curl -s -b $O -o /dev/null -X POST $B/admin/settings \
    -d "submissions_mode=$1&submissions_opens_on=$2&submissions_closes_on=$3&submissions_reply_by=$4"
}

TODAY=$(date +%F)
PAST=$(date -d '-10 days' +%F)
SOON=$(date -d '+10 days' +%F)
LATER=$(date -d '+40 days' +%F)

echo "== The reader, signed out =="
check "GET /            200" 200 "$(status $B/)"
check "GET /issues      200" 200 "$(status $B/issues)"
check "GET /about       200" 200 "$(status $B/about)"
check "GET /submit      200" 200 "$(status $B/submit)"
check "GET /nope        404" 404 "$(status $B/nope)"
check "GET /admin       302" 302 "$(status $B/admin)"
check "GET /admin/issues 302" 302 "$(status $B/admin/issues)"

echo "== The header bar and the way in =="
has "the administrative link is in the footer" 'class="footer-admin"' $B/
has "it is labelled Administrative"            '>Administrative<'     $B/
has "the credit is on the home page"           'Website built by Emmet' $B/
has "the credit is on every page"              'Website built by Emmet' $B/submit
curl -s -o /tmp/resp.html $B/
if [ "$(python3 - <<'PY'
import re
html = open('/tmp/resp.html').read()
bar = re.search(r'<div class="bar">.*?</div>', html, re.S)
print('yes' if bar and 'Administrative' not in bar.group(0) else 'no')
PY
)" = "yes" ]; then echo "  ok    the header bar holds only the reader links"; PASS=$((PASS+1));
else echo "  FAIL  the header bar still holds the admin link"; FAIL=$((FAIL+1)); fi

echo "== The owner signs in =="
curl -s -c $O -o /dev/null -X POST $B/login -d "email=owner@repartie.test&password=testpassword"
check "owner reaches the desk"     200 "$(status -b $O $B/admin)"
check "owner reaches issues"       200 "$(status -b $O $B/admin/issues)"
check "owner reaches settings"     200 "$(status -b $O $B/admin/settings)"
check "owner reaches people"       200 "$(status -b $O $B/admin/people)"
check "a wrong password is refused" 401 "$(status -X POST $B/login -d 'email=owner@repartie.test&password=nope')"
has "signed in, sign-out is reachable from the footer" 'action="/logout"' -b $O $B/
has "signed in, the footer points at the desk"         'href="/admin"'    -b $O $B/

echo "== The submission window =="
set_window closed "" "" ""
has "closed: the notice shows" "We are not reading right now" $B/submit
hasnt "closed: no form" 'name="essay_url"' $B/submit
check "closed: a POST is refused" 403 \
  "$(status -X POST $B/submit -d 'name=A&email=a@gmail.com&essay_url=https://x.com/e')"

set_window scheduled "$SOON" "$LATER" "$LATER"
has "upcoming: says when it opens" "Submissions open on" $B/submit
hasnt "upcoming: still no form" 'name="essay_url"' $B/submit
check "upcoming: a POST is refused" 403 \
  "$(status -X POST $B/submit -d 'name=A&email=a@gmail.com&essay_url=https://x.com/e')"

set_window scheduled "$PAST" "$LATER" "$LATER"
has "open: says it is open" "Submissions are open" $B/submit
has "open: the form is there" 'name="essay_url"' $B/submit
has "open: promises a reply-by date" "You will hear by" $B/submit
has "open: the footer agrees" "Open for submissions" $B/

echo "== A reader submits, with no account =="
has "a good submission is thanked" "Got it. We read everything" \
  -X POST $B/submit -d "name=Iris Vale&email=iris@gmail.com&essay_url=https://example.com/cormorant"
has "a non-URL link is refused" "starting with http" \
  -X POST $B/submit -d "name=Iris&email=iris@gmail.com&essay_url=just some words"
has "a javascript: link is refused" "starting with http" \
  -X POST $B/submit -d "name=Iris&email=iris@gmail.com&essay_url=javascript:alert(1)"
has "a missing name is refused" "Add your name" \
  -X POST $B/submit -d "name=&email=iris@gmail.com&essay_url=https://example.com/x"

echo "== Validating the submitter's email =="
has "a bad email is refused"  "does not look right" \
  -X POST $B/submit -d "name=Iris&email=nonsense&essay_url=https://example.com/x"

# This one needs a working resolver. Without one the check fails open, by design.
if [ "$(node -e "require('dns').promises.resolveMx('nxdomain-repartie-test-12345.com').then(()=>console.log('no'),e=>console.log(e.code==='ENOTFOUND'?'yes':'no'))")" = "yes" ]; then
  has "an invented domain is refused" "cannot find a mail server" \
    -X POST $B/submit -d "name=Iris&email=iris@nxdomain-repartie-test-12345.com&essay_url=https://example.com/x"
  has "a domain that refuses mail is refused" "does not accept mail" \
    -X POST $B/submit -d "name=Iris&email=iris@example.com&essay_url=https://example.com/x"
else
  echo "  skip  domain checks — no resolver here (the check fails open, as designed)"
fi

echo "== Blocking a submitter =="
curl -s -b $O -o /dev/null -X POST $B/admin/blocked -d "pattern=nuisance@gmail.com&note=Enough"
has "the block is listed" "nuisance@gmail.com" -b $O $B/admin/blocked
has "a blocked address is turned away" "not able to accept" \
  -X POST $B/submit -d "name=N&email=nuisance@gmail.com&essay_url=https://example.com/x"
check "and it is refused with a 403" 403 \
  "$(status -X POST $B/submit -d 'name=N&email=nuisance@gmail.com&essay_url=https://example.com/x')"
hasnt "the blocked submission never reached the table" "nuisance@gmail.com" -b $O $B/admin

curl -s -b $O -o /dev/null -X POST $B/admin/blocked -d "pattern=@spammy.example&note=whole domain"
has "a whole domain can be blocked" "@spammy.example" -b $O $B/admin/blocked
check "anyone at that domain is turned away" 403 \
  "$(status -X POST $B/submit -d 'name=S&email=someone@spammy.example&essay_url=https://example.com/x')"
check "a bare domain is read as a domain" 400 \
  "$(status -b $O -X POST $B/admin/blocked -d 'pattern=@spammy.example')"
has "blocking the same thing twice is refused" "already blocked" \
  -b $O -X POST $B/admin/blocked -d "pattern=spammy.example"
has "nonsense cannot be blocked" "not an address or a domain" \
  -b $O -X POST $B/admin/blocked -d "pattern=notanaddress"

BLOCK_ID=$(node -e "
  const db = require('better-sqlite3')('$DATA_DIR/repartie.db');
  process.stdout.write(String(db.prepare(\"SELECT id FROM blocked WHERE pattern = 'nuisance@gmail.com'\").get().id));
")
curl -s -b $O -o /dev/null -X POST $B/admin/blocked/$BLOCK_ID/delete
has "unblocking lets them back in" "Got it. We read everything" \
  -X POST $B/submit -d "name=N&email=nuisance@gmail.com&essay_url=https://example.com/reformed"

echo "== The owner's table =="
has "the name is listed"   "Iris Vale"                        -b $O $B/admin
has "the email is listed"  "iris@gmail.com"                    -b $O $B/admin
has "the link is listed"   "https://example.com/cormorant"    -b $O $B/admin
has "it starts pending"    "stamp-pending\">pending"          -b $O "$B/admin?status=pending"
has "there is a selector"  'name="status"'                    -b $O $B/admin

curl -s -b $O -o /dev/null -X POST $B/admin/submissions/1 -d "status=approved&owner_notes=Take it."
has "approving sticks"     "approved"  -b $O "$B/admin?status=approved"
has "notes stick"          "Take it."  -b $O $B/admin
has "approved gets a file-it link" "File in an issue" -b $O $B/admin
curl -s -b $O -o /dev/null -X POST $B/admin/submissions/1 -d "status=rescinded"
has "rescinding sticks"    "rescinded" -b $O "$B/admin?status=rescinded"
curl -s -b $O -o /dev/null -X POST $B/admin/submissions/1 -d "status=approved&owner_notes=Take it."

echo "== Building an issue =="
curl -s -b $O -o /dev/null -X POST $B/admin/issues -d "number=1&title=The Water Issue&dateline=Spring 2026"
check "the issue editor opens" 200 "$(status -b $O $B/admin/issues/1)"
has "filing prefills the author" "Iris Vale" -b $O "$B/admin/issues/1?from=1"

curl -s -b $O -o /dev/null -X POST $B/admin/issues/1/pieces \
  -d "title=The Cormorant&author=Iris Vale&url=https://example.com/cormorant&blurb=A bird, briefly."
curl -s -b $O -o /dev/null -X POST $B/admin/issues/1/pieces \
  -d $'title=On the Freeway&author=M. Roth&body=It was noon on the 580.\n\nNobody moved.'

hasnt "a draft issue is hidden from readers" "The Water Issue" $B/issues
check "a draft issue 404s for readers" 404 "$(status $B/issues/no-1-the-water-issue)"

curl -s -b $O -o /dev/null -X POST $B/admin/issues/1/publish -d "publish=yes"
has "the published issue appears"     "The Water Issue"  $B/issues
has "the contents list the pieces"    "The Cormorant"    $B/issues
has "an external piece links out"     "https://example.com/cormorant" $B/issues
has "the home page shows the issue"   "The Water Issue"  $B/
check "the issue page opens"          200 "$(status $B/issues/no-1-the-water-issue)"
has "a hosted piece renders on site"  "Nobody moved."    $B/issues/no-1-the-water-issue/on-the-freeway
check "a link-only piece has no page" 404 "$(status $B/issues/no-1-the-water-issue/the-cormorant)"

curl -s -b $O -o /dev/null -X POST $B/admin/issues/1/publish -d "publish=no"
hasnt "unpublishing hides it again" "The Water Issue" $B/issues
curl -s -b $O -o /dev/null -X POST $B/admin/issues/1/publish -d "publish=yes"

echo "== Owner edits the site =="
curl -s -b $O -o /dev/null -X POST $B/admin/settings \
  -d "site_title=Repartie&site_tagline=Changed by the owner&nav_issues=The Archive&home_heading=Repartie"
has "the tagline changed"   "Changed by the owner" $B/
has "the nav label changed" "The Archive"          $B/

echo "== Inviting an owner =="
curl -s -b $O -o /dev/null -X POST $B/admin/people/invite -d "email=two@test.com"
has "the invitation is listed" "two@test.com" -b $O $B/admin/people
has "there is a link to send" "/invite/" -b $O $B/admin/people

curl -s -b $O -o /tmp/people.html $B/admin/people
TOKEN=$(grep -o 'invite/[A-Za-z0-9_-]\{30,\}' /tmp/people.html | head -1 | cut -d/ -f2)
check "the invite link opens"        200 "$(status $B/invite/$TOKEN)"
has  "it names the invited address"  "two@test.com" $B/invite/$TOKEN
check "a made-up token is refused"   410 "$(status $B/invite/notarealtoken)"
check "inviting an existing owner is refused" 400 \
  "$(status -b $O -X POST $B/admin/people/invite -d 'email=owner@repartie.test')"

has "mismatched passwords are refused" "do not match" \
  -X POST $B/invite/$TOKEN -d "name=Second Owner&password=alongenoughpassword&confirm=somethingelse00"
has "a short password is refused" "at least 10 characters" \
  -X POST $B/invite/$TOKEN -d "name=Second Owner&password=short&confirm=short"

check "accepting signs them straight in" 302 \
  "$(status -X POST $B/invite/$TOKEN -d 'name=Second Owner&password=alongenoughpassword&confirm=alongenoughpassword')"
has "the new owner is on the masthead" "Second Owner" -b $O $B/admin/people
check "the new owner can sign in" 302 \
  "$(status -X POST $B/login -d 'email=two@test.com&password=alongenoughpassword')"
check "the link cannot be used twice" 410 "$(status $B/invite/$TOKEN)"
hasnt "a spent invitation leaves the list" "Tear it up" -b $O $B/admin/people

echo "== Invitations expire and can be torn up =="
curl -s -b $O -o /dev/null -X POST $B/admin/people/invite -d "email=three@test.com"
curl -s -b $O -o /tmp/people.html $B/admin/people
TOKEN3=$(grep -o 'invite/[A-Za-z0-9_-]\{30,\}' /tmp/people.html | head -1 | cut -d/ -f2)
check "a fresh link works" 200 "$(status $B/invite/$TOKEN3)"

node -e "
  const db = require('better-sqlite3')('$DATA_DIR/repartie.db');
  db.prepare(\"UPDATE invites SET expires_at = '2020-01-01 00:00:00' WHERE token = ?\").run('$TOKEN3');
"
check "an expired link is refused"       410 "$(status $B/invite/$TOKEN3)"
check "an expired link cannot be posted" 410 \
  "$(status -X POST $B/invite/$TOKEN3 -d 'name=Third&password=alongenoughpassword&confirm=alongenoughpassword')"
has  "the desk shows it as expired"      "expired" -b $O $B/admin/people

curl -s -b $O -o /dev/null -X POST $B/admin/people/invite -d "email=four@test.com"
curl -s -b $O -o /tmp/people.html $B/admin/people
TOKEN4=$(grep -o 'invite/[A-Za-z0-9_-]\{30,\}' /tmp/people.html | head -1 | cut -d/ -f2)
INVITE_ID=$(node -e "
  const db = require('better-sqlite3')('$DATA_DIR/repartie.db');
  process.stdout.write(String(db.prepare('SELECT id FROM invites WHERE token = ?').get('$TOKEN4').id));
")
curl -s -b $O -o /dev/null -X POST $B/admin/people/invite/$INVITE_ID/revoke
check "a torn-up link is dead" 410 "$(status $B/invite/$TOKEN4)"

echo "== Removing an owner =="
SECOND_ID=$(node -e "
  const db = require('better-sqlite3')('$DATA_DIR/repartie.db');
  process.stdout.write(String(db.prepare(\"SELECT id FROM owners WHERE email = 'two@test.com'\").get().id));
")
curl -s -b $O -o /dev/null -X POST $B/admin/people/$SECOND_ID/delete
hasnt "the removed owner is gone" "two@test.com" -b $O $B/admin/people
check "and can no longer sign in" 401 \
  "$(status -X POST $B/login -d 'email=two@test.com&password=alongenoughpassword')"

echo "== Changing your own password =="
A=/tmp/acct-cookies.txt
curl -s -c $A -o /dev/null -X POST $B/login -d "email=owner@repartie.test&password=testpassword"
check "the account page opens" 200 "$(status -b $A $B/account)"
has "a wrong current password is refused" "not your current password" \
  -b $A -X POST $B/account/password -d "current=wrong&password=brandnewpassword&confirm=brandnewpassword"
has "a short new password is refused" "at least 10 characters" \
  -b $A -X POST $B/account/password -d "current=testpassword&password=short&confirm=short"
has "mismatched new passwords are refused" "do not match" \
  -b $A -X POST $B/account/password -d "current=testpassword&password=brandnewpassword&confirm=different0000"
has "reusing the same password is refused" "already have" \
  -b $A -X POST $B/account/password -d "current=testpassword&password=testpassword&confirm=testpassword"

curl -s -b $A -o /dev/null -X POST $B/account/password \
  -d "current=testpassword&password=brandnewpassword&confirm=brandnewpassword"
check "the old password stops working" 401 \
  "$(status -X POST $B/login -d 'email=owner@repartie.test&password=testpassword')"
check "the new password works"         302 \
  "$(status -X POST $B/login -d 'email=owner@repartie.test&password=brandnewpassword')"

echo "== The standard credentials, on a fresh database =="
# A second server, booted with no OWNER_ env and — crucially — from a directory with no
# .env in it, so we see exactly what a brand new install does.
S=/tmp/repartie-standard
APP=$(pwd)
rm -rf $S
(cd /tmp && exec env -u OWNER_EMAIL -u OWNER_PASSWORD -u OWNER_NAME \
   DATA_DIR=$S PORT=3101 node "$APP/server.js" > /tmp/standard.log 2>&1 < /dev/null) &
STD_PID=$!
trap 'kill $SERVER_PID $STD_PID 2>/dev/null' EXIT
for _ in $(seq 1 40); do curl -sf -o /dev/null http://localhost:3101/ && break; sleep 0.3; done

N=http://localhost:3101
C=/tmp/std-cookies.txt
check "the standard credentials sign in" 302 \
  "$(status -c $C -X POST $N/login -d 'email=sweaty@boners.com&password=Password1')"
check "but the desk is shut"             302 "$(status -b $C $N/admin)"
has  "and it says why"                   "Make this account yours" -b $C $N/account
has  "the setup page warns about /admin" "stays shut"              -b $C $N/account

curl -s -b $C -o /dev/null -X POST $N/account/password \
  -d "current=Password1&password=a-real-password&confirm=a-real-password"
check "changing it opens the desk"   200 "$(status -b $C $N/admin)"
check "the standard password is dead" 401 \
  "$(status -X POST $N/login -d 'email=sweaty@boners.com&password=Password1')"

curl -s -b $C -o /dev/null -X POST $N/account/details \
  -d "name=The Owner&email=real@example.com"
check "the new address signs in" 302 \
  "$(status -X POST $N/login -d 'email=real@example.com&password=a-real-password')"
check "the standard address is gone" 401 \
  "$(status -X POST $N/login -d 'email=sweaty@boners.com&password=a-real-password')"

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
