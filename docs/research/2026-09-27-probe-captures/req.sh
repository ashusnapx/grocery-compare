#!/bin/bash
# usage: req.sh <platform> <name> [extra curl args...] <url>
# Env: ACCEPT (override accept header), JAR (cookie jar file to read+write)
# Headers mirror med-compare/src/lib/http.ts DEFAULT_HEADERS.
P=$1; N=$2; shift 2
ROOT=/private/tmp/claude-501/-Users-ashutoshkumar-grocery-compare/a898e367-9b1b-4309-a51a-c603e749ac46/scratchpad/probe
D=$ROOT/$P
mkdir -p "$D"
UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
ACC=${ACCEPT:-'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'}
JARARGS=()
if [ -n "$JAR" ]; then JARARGS=(-b "$JAR" -c "$JAR"); fi
OUT=$(curl -sS -m 25 --compressed -A "$UA" -H "accept: $ACC" -H 'accept-language: en-IN,en;q=0.9' \
  "${JARARGS[@]}" -D "$D/$N.h" -o "$D/$N.b" \
  -w '%{http_code}\t%{size_download}\t%{time_total}\t%{content_type}\t%{url_effective}\t%{num_redirects}' "$@" 2>&1)
RC=$?
# tell-tale headers
TT=$(grep -i -E '^(server|cf-ray|cf-mitigated|x-amzn-waf-action|x-cache|akamai|x-akamai|x-rate-limit|x-iinfo|x-datadome|set-cookie: (_abck|bm_|ak_bmsc|__cf|cf_))' "$D/$N.h" 2>/dev/null | cut -c1-90 | tr '\r\n' '  ')
printf '%s\t%s\t%s\trc=%s\t%s\t%s\n' "$(date +%H:%M:%S)" "$P" "$N" "$RC" "$OUT" "$TT" | tee -a "$ROOT/requests.log"
