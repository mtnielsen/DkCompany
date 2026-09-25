#!/usr/bin/env bash
#
# Læg DKC-036-overlayen oven på en checkout, hvor hele den nuværende stak
# (stak-tip DKC-035 og alle forudsætninger) allerede er lagt.
#
#   ./apply.sh /sti/til/checkout/00-core
#
# DKC-036 (enterprise- og brancheprofiler) afhænger formelt af DKC-023, DKC-033,
# DKC-034 og DKC-035. Overlayen lægges oven på hele stakken via
# dkc-035/apply.sh, som kæder dkc-033/apply.sh → dkc-065/apply.sh → … →
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

echo "1/2 Lægger stak-tippet DKC-035 og alle forudsætninger"
"$OUTPUT/dkc-035/apply.sh" "$TARGET" >/dev/null

echo "2/2 Lægger DKC-036 fra $OVERLAY"
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
echo "  make enterprise-check && make enterprise-test && make enterprise-run"
echo "  make enterprise-render && make enterprise-check"
echo "  make distribution-check"
echo "  make validate && make lint"
echo "  make release-check"
echo "  make test"
echo "  make baseline   # forventer 279 checks: 218 PASS, 1 kendt FAIL (changelog-check), 60 NOT RUN"
