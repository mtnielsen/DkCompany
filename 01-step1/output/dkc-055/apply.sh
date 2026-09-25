#!/usr/bin/env bash
#
# Læg DKC-055-overlayen oven på en checkout, hvor DKC-001..DKC-008 alle er lagt.
#
#   ./apply.sh /sti/til/checkout/00-core
#
# DKC-055 afhænger af DKC-003, DKC-004 og DKC-007 og bygger i praksis ovenpå
# hele stakken, så scriptet lægger forudsætningerne først via dkc-008/apply.sh.
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

echo "1/2 Lægger DKC-001 .. DKC-008 (forudsætninger)"
"$OUTPUT/dkc-008/apply.sh" "$TARGET" >/dev/null

echo "2/2 Lægger DKC-055 fra $OVERLAY"
( cd "$OVERLAY" && find . -type f -print0 ) | while IFS= read -r -d '' rel; do
  rel="${rel#./}"
  dest="$TARGET/$rel"
  mkdir -p "$(dirname "$dest")"
  cp "$OVERLAY/$rel" "$dest"
  echo "  → $rel"
done

echo
echo "Færdig. Kør i målet:"
echo "  make install"
echo "  make agent-registry-check && make agent-registry-test"
echo "  make runtime-test && make approval-test"
echo "  make validate && make test"
echo "  make baseline-test && make baseline"
