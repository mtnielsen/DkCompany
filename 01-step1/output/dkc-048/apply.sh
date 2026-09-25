#!/usr/bin/env bash
#
# Læg DKC-048-overlayen oven på en checkout, hvor hele den nuværende stak
# (DKC-001 .. DKC-041) allerede er lagt.
#
#   ./apply.sh /sti/til/checkout/00-core
#
# DKC-048 afhænger formelt af DKC-010, DKC-041 og DKC-047. Den lægges oven på
# hele stakken via dkc-041/apply.sh, som kæder dkc-039/apply.sh →
# dkc-040/apply.sh → dkc-038/apply.sh → … → DKC-001.
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

echo "1/2 Lægger DKC-001 .. DKC-041 (forudsætninger)"
"$OUTPUT/dkc-041/apply.sh" "$TARGET" >/dev/null

echo "2/2 Lægger DKC-048 fra $OVERLAY"
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
echo "  make validate && make lint"
echo "  make immutable-render && make immutable-check && make immutable-test"
echo "  make data-protection-check && make data-protection-test"
echo "  make storage-check && make storage-test"
echo "  make release-check && make release-test"
echo "  make test"
echo "  make baseline"
