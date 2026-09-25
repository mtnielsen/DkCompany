#!/usr/bin/env bash
#
# Læg DKC-005-overlayen oven på en checkout, hvor DKC-001..DKC-004 alle er lagt.
#
#   ./apply.sh /sti/til/checkout/00-core
#
# DKC-005 afhænger af DKC-004 (autentiske, ændringsbundne godkendelser), DKC-003
# (verificerbar identitet), DKC-002 (arkitekturkontrakter) og DKC-001
# (baselineværktøjet), så scriptet lægger forudsætningerne først.
#
# Bemærk: DKC-005 forudsætter også DKC-055 (én rolle pr. agent). Den er ikke
# implementeret i denne leverance; se README'ens blokeringsafsnit.
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

echo "1/2 Lægger DKC-001 + DKC-002 + DKC-003 + DKC-004 (forudsætninger)"
"$OUTPUT/dkc-004/apply.sh" "$TARGET" >/dev/null

echo "2/2 Lægger DKC-005 fra $OVERLAY"
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
echo "  make runtime-test"
echo "  make validate"
echo "  make baseline-test && make baseline"
