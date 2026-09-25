#!/usr/bin/env bash
#
# Læg DKC-009-overlayen oven på en checkout, hvor DKC-001..DKC-008 og DKC-055
# alle er lagt.
#
#   ./apply.sh /sti/til/checkout/00-core
#
# DKC-009 afhænger formelt af DKC-007 (grænsevalidering) og DKC-008 (holdbar
# tilstand). Den bygger desuden på DKC-055 for den adskilte audit-skrive-/
# læserrolle og det fælles rollesystem, og lægges derfor oven på hele den
# nuværende stak via dkc-055/apply.sh (som kæder dkc-008 → ... → dkc-001).
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

echo "1/2 Lægger DKC-001 .. DKC-008 + DKC-055 (forudsætninger)"
"$OUTPUT/dkc-055/apply.sh" "$TARGET" >/dev/null

echo "2/2 Lægger DKC-009 fra $OVERLAY"
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
echo "  make audit-durability-check && make audit-durability-test"
echo "  make persistence-check && make persistence-test"
echo "  make runtime-test && make audit-service-test"
echo "  make validate && make test"
echo "  make baseline-test && make baseline"
