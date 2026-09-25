#!/usr/bin/env bash
#
# Læg DKC-033-overlayen oven på en checkout, hvor hele den nuværende stak
# (stak-tip DKC-065 og alle forudsætninger) allerede er lagt.
#
#   ./apply.sh /sti/til/checkout/00-core
#
# DKC-033 (pilotforløb og readiness-kontrol) afhænger formelt af DKC-016,
# DKC-017, DKC-018, DKC-022, DKC-024..DKC-032, DKC-062 og DKC-065. Overlayen
# lægges oven på hele stakken via dkc-065/apply.sh, som kæder dkc-062/apply.sh →
# dkc-061/apply.sh → … → dkc-001/apply.sh.
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

echo "1/2 Lægger stak-tippet DKC-065 og alle forudsætninger"
"$OUTPUT/dkc-065/apply.sh" "$TARGET" >/dev/null

echo "2/2 Lægger DKC-033 fra $OVERLAY"
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
echo "  make pilot-check && make pilot-test"
echo "  make pilot-run && make pilot-render && make pilot-report"
echo "  make validate && make lint"
echo "  make release-check"
echo "  make test"
echo "  make baseline   # forventer 269 checks: 210 PASS, 1 kendt FAIL (changelog-check), 58 NOT RUN"
