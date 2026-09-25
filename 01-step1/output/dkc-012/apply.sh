#!/usr/bin/env bash
#
# Læg DKC-012-overlayen oven på en checkout, hvor DKC-001 .. DKC-013 og DKC-055
# alle er lagt.
#
#   ./apply.sh /sti/til/checkout/00-core
#
# DKC-012 afhænger formelt af DKC-003 (verificerbar identitet), DKC-006
# (tenantisolering), DKC-008 (holdbar tilstand) og DKC-011 (værktøjsgrænse).
# Den lægges oven på hele den nuværende stak via dkc-013/apply.sh, som kæder
# dkc-011/apply.sh og dermed DKC-001 .. DKC-011 + DKC-055. DKC-013 er valgt som
# forudsætning, fordi den er den aktuelle stak-top.
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

echo "1/2 Lægger DKC-001 .. DKC-013 + DKC-055 (forudsætninger)"
"$OUTPUT/dkc-013/apply.sh" "$TARGET" >/dev/null

echo "2/2 Lægger DKC-012 fra $OVERLAY"
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
echo "  make gateway-check && make gateway-test && make budget-test"
echo "  make model-egress-check && make model-gateway-test"
echo "  make persistence-check && make persistence-test"
echo "  make runtime-test && make boundary-test"
echo "  make validate && make lint && make test"
echo "  make baseline-test && make baseline"
