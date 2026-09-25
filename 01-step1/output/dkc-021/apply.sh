#!/usr/bin/env bash
#
# Læg DKC-021-overlayen oven på en checkout, hvor hele den nuværende stak
# (DKC-001 .. DKC-048) allerede er lagt.
#
#   ./apply.sh /sti/til/checkout/00-core
#
# DKC-021 afhænger formelt af DKC-016, DKC-019, DKC-020 og DKC-048. Den lægges
# oven på hele stakken via dkc-048/apply.sh, som kæder dkc-041/apply.sh →
# dkc-039/apply.sh → dkc-040/apply.sh → dkc-038/apply.sh → … → DKC-001.
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

echo "1/2 Lægger DKC-001 .. DKC-048 (forudsætninger)"
"$OUTPUT/dkc-048/apply.sh" "$TARGET" >/dev/null

echo "2/2 Lægger DKC-021 fra $OVERLAY"
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
echo "  make retention-write && make retention-check && make retention-test"
echo "  make data-register-check && make data-register-test"
echo "  make data-protection-check && make data-protection-test"
echo "  make persistence-check && make persistence-test"
echo "  make release-check && make release-test"
echo "  make test"
echo "  make baseline"
