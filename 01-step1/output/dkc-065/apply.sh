#!/usr/bin/env bash
#
# Læg DKC-065-overlayen oven på en checkout, hvor hele den nuværende stak
# (stak-tip DKC-062 og alle forudsætninger) allerede er lagt.
#
#   ./apply.sh /sti/til/checkout/00-core
#
# DKC-065 (pentest-harness og assessment-gates) afhænger formelt af DKC-062,
# DKC-064 og DKC-066. Overlayen lægges oven på hele stakken via
# dkc-062/apply.sh, som kæder dkc-061/apply.sh → dkc-059/apply.sh → … →
# dkc-001/apply.sh.
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

echo "1/2 Lægger stak-tippet DKC-062 og alle forudsætninger"
"$OUTPUT/dkc-062/apply.sh" "$TARGET" >/dev/null

echo "2/2 Lægger DKC-065 fra $OVERLAY"
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
echo "  make security-assessment-check && make security-assessment-test"
echo "  make security-assessment-run && make security-assessment-report"
echo "  make validate && make lint"
echo "  make release-check"
echo "  make test"
echo "  make baseline   # forventer 264 checks: 206 PASS, 1 kendt FAIL (changelog-check), 57 NOT RUN"
