#!/usr/bin/env bash
#
# Læg DKC-002-overlayen oven på en checkout, hvor DKC-001 allerede er lagt.
#
#   ./apply.sh /sti/til/checkout/00-core
#
# DKC-002 afhænger af DKC-001 (baselineværktøjet og den rettede Makefile), så
# dette script lægger DKC-001 først og DKC-002 bagefter.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
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

echo "1/2 Lægger DKC-001 (forudsætning)"
DKC001_APPLY="$ROOT/apply.sh"
if [[ ! -f "$DKC001_APPLY" && -f "$ROOT/dkc-001/apply.sh" ]]; then
  DKC001_APPLY="$ROOT/dkc-001/apply.sh"
fi
"$DKC001_APPLY" "$TARGET" >/dev/null

echo "2/2 Lægger DKC-002 fra $OVERLAY"
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
echo "  make validate"
echo "  make architecture-test"
echo "  make test"
