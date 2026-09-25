#!/usr/bin/env bash
#
# Læg DKC-062-overlayen oven på en checkout, hvor hele den nuværende stak
# (stak-tip DKC-061 og alle forudsætninger) allerede er lagt.
#
#   ./apply.sh /sti/til/checkout/00-core
#
# DKC-062 (installations- og releaseacceptance) afhænger formelt af DKC-022,
# DKC-054, DKC-055, DKC-057, DKC-060, DKC-061, DKC-064 og DKC-066. Overlayen
# lægges oven på hele stakken via dkc-061/apply.sh, som kæder dkc-059/apply.sh →
# dkc-031/apply.sh → … → dkc-001/apply.sh.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT="$(cd "$HERE/.." && pwd)"
OVERLAY="$HERE/deliverable"
TARGET="${1:-}"

if [[ -z "$TARGET" ]]; then
  echo "Brug: $0 <sti-til-checkout-med-00-core>" >&2
  exit 2
fi
if [[ ! -d "$TARGET" ]]; then
  echo "Målet findes ikke: $TARGET" >&2
  exit 2
fi

echo "1/2 Lægger stak-tippet DKC-061 og alle forudsætninger"
"$OUTPUT/dkc-061/apply.sh" "$TARGET" >/dev/null

echo "2/2 Lægger DKC-062 fra $OVERLAY"
( cd "$OVERLAY" && find . -type f -print0 ) | while IFS= read -r -d '' rel; do
  rel="${rel#./}"
  dest="$TARGET/$rel"
  mkdir -p "$(dirname "$dest")"
  cp "$OVERLAY/$rel" "$dest"
done
echo "  → $(cd "$OVERLAY" && find . -type f | wc -l) filer lagt"

echo
echo "Færdig. Kør i målet:"
echo "  make install"
echo "  make acceptance-check && make acceptance-test && make acceptance-run"
echo "  make acceptance-render && make acceptance-report"
echo "  make validate && make lint"
echo "  make release-check"
echo "  make distribution-check && make distribution-test"
echo "  make test"
echo "  make baseline   # forventer 259 checks: 202 PASS, 1 kendt FAIL (changelog-check), 56 NOT RUN"
