#!/usr/bin/env bash
#
# Læg DKC-003-overlayen oven på en checkout, hvor DKC-001 og DKC-002 er lagt.
#
#   ./apply.sh /sti/til/checkout/00-core
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

echo "1/2 Lægger DKC-001 + DKC-002 (forudsætninger)"
"$OUTPUT/dkc-002/apply.sh" "$TARGET" >/dev/null

echo "2/2 Lægger DKC-003 fra $OVERLAY"
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
echo "  make identity-test"
echo "  make gateway-test"
echo "  make audit-service-test"
echo "  make adapter-test && make iam-adapter-test"
