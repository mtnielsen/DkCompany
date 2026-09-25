#!/usr/bin/env bash
#
# Læg DKC-011-overlayen oven på en checkout, hvor DKC-001 .. DKC-010 og DKC-055
# alle er lagt.
#
#   ./apply.sh /sti/til/checkout/00-core
#
# DKC-011 afhænger formelt af DKC-007 (runtimegrænse/A4) og DKC-010
# (kortlivede rettigheder/nødstop). Den bygger oven på hele den nuværende stak
# og lægges derfor via dkc-010/apply.sh, som til gengæld kæder dkc-009/apply.sh
# og dermed DKC-008 .. DKC-001 + DKC-055.
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

echo "1/2 Lægger DKC-001 .. DKC-010 + DKC-055 (forudsætninger)"
"$OUTPUT/dkc-010/apply.sh" "$TARGET" >/dev/null

echo "2/2 Lægger DKC-011 fra $OVERLAY"
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
echo "  make tool-boundary-check && make tool-boundary-test"
echo "  make runtime-test && make boundary-test"
echo "  make validate && make lint && make test"
echo "  make credentials-test && make persistence-test"
echo "  make baseline-test && make baseline"
