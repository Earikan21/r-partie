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

echo "== The owner signs in =="
curl -s -c $O -o /dev/null -X POST $B/login -d "email=owner@repartie.test&password=testpassword"
check "owner reaches the desk"     200 "$(status -b $O $B/admin)"
check "owner reaches issues"       200 "$(status -b $O $B/admin/issues)"
check "owner reaches settings"     200 "$(status -b $O $B/admin/settings)"
check "owner reaches people"       200 "$(status -b $O $B/admin/people)"
check "a wrong password is refused" 401 "$(status -X POST $B/login -d 'email=owner@repartie.test&password=nope')"

echo "== The submission window =="
set_window closed "" "" ""
has "closed: the notice shows" "We are not reading right now" $B/submit
hasnt "closed: no form" 'name="essay_url"' $B/submit
check "closed: a POST is refused" 403 \
  "$(status -X POST $B/submit -d 'name=A&email=a@b.com&essay_url=https://x.com/e')"

set_window scheduled "$SOON" "$LATER" "$LATER"
has "upcoming: says when it opens" "Submissions open on" $B/submit
hasnt "upcoming: still no form" 'name="essay_url"' $B/submit
check "upcoming: a POST is refused" 403 \
  "$(status -X POST $B/submit -d 'name=A&email=a@b.com&essay_url=https://x.com/e')"

set_window scheduled "$PAST" "$LATER" "$LATER"
has "open: says it is open" "Submissions are open" $B/submit
has "open: the form is there" 'name="essay_url"' $B/submit
has "open: promises a reply-by date" "You will hear by" $B/submit
has "open: the footer agrees" "Open for submissions" $B/

echo "== A reader submits, with no account =="
has "a good submission is thanked" "Got it. We read everything" \
  -X POST $B/submit -d "name=Iris Vale&email=iris@test.com&essay_url=https://example.com/cormorant"
has "a bad email is refused" "does not look right" \
  -X POST $B/submit -d "name=Iris&email=nonsense&essay_url=https://example.com/x"
has "a non-URL link is refused" "starting with http" \
  -X POST $B/submit -d "name=Iris&email=iris@test.com&essay_url=just some words"
has "a javascript: link is refused" "starting with http" \
  -X POST $B/submit -d "name=Iris&email=iris@test.com&essay_url=javascript:alert(1)"
has "a missing name is refused" "Add your name" \
  -X POST $B/submit -d "name=&email=iris@test.com&essay_url=https://example.com/x"

echo "== The owner's table =="
has "the name is listed"   "Iris Vale"                        -b $O $B/admin
has "the email is listed"  "iris@test.com"                    -b $O $B/admin
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

echo "== Owners =="
curl -s -b $O -o /dev/null -X POST $B/admin/people \
  -d "name=Second Owner&email=two@test.com&password=alongenoughpassword"
has "the new owner is listed" "two@test.com" -b $O $B/admin/people
check "the new owner can sign in" 302 \
  "$(status -X POST $B/login -d 'email=two@test.com&password=alongenoughpassword')"
has "a short password is refused" "at least 10 characters" \
  -b $O -X POST $B/admin/people -d "name=Third&email=three@test.com&password=short"

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
