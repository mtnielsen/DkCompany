#!/usr/bin/env bash
#
# Læg DKC-010-overlayen oven på en checkout, hvor DKC-001..DKC-009 og DKC-055
# alle er lagt.
#
#   ./apply.sh /sti/til/checkout/00-core
#
# DKC-010 afhænger formelt af DKC-003 (identitet), DKC-007 (grænsevalidering) og
# DKC-055 (én rolle pr. agent). Den bygger desuden på DKC-008 (persistens) og
# DKC-009 (holdbar audit) for holdbar tilbagekaldelse/nødstop, og lægges derfor
# oven på hele den nuværende stak via dkc-009/apply.sh.
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

echo "1/2 Lægger DKC-001 .. DKC-009 + DKC-055 (forudsætninger)"
"$OUTPUT/dkc-009/apply.sh" "$TARGET" >/dev/null

echo "2/2 Lægger DKC-010 fra $OVERLAY"
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
echo "  make credentials-check && make credentials-test"
echo "  make persistence-check && make persistence-test"
echo "  make runtime-test && make audit-service-test && make gitops-test"
echo "  make validate && make test"
echo "  make baseline-test && make baseline"
