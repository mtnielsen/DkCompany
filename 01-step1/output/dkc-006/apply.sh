#!/usr/bin/env bash
#
# Læg DKC-006-overlayen oven på en checkout, hvor DKC-001..DKC-005 alle er lagt.
#
#   ./apply.sh /sti/til/checkout/00-core
#
# DKC-006 afhænger af DKC-003 (verificerbar identitet), men bygger i praksis
# ovenpå hele stakken (DKC-001 baseline, DKC-002 arkitekturkontrakter, DKC-004
# godkendelser, DKC-005 runtime-verifikation), så scriptet lægger
# forudsætningerne først.
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

echo "1/2 Lægger DKC-001 + DKC-002 + DKC-003 + DKC-004 + DKC-005 (forudsætninger)"
"$OUTPUT/dkc-005/apply.sh" "$TARGET" >/dev/null

echo "2/2 Lægger DKC-006 fra $OVERLAY"
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
echo "  make tenant-check && make tenant-test"
echo "  make validate"
echo "  make runtime-test && make approval-test"
echo "  make baseline-test && make baseline"
