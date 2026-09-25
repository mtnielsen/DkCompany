#!/usr/bin/env bash
#
# Læg DKC-064-overlayen oven på en checkout, hvor hele den nuværende stak
# (DKC-001 .. DKC-015 + DKC-018) allerede er lagt.
#
#   ./apply.sh /sti/til/checkout/00-core
#
# DKC-064 afhænger formelt af DKC-014, DKC-018, DKC-055 og DKC-063. Den lægges
# oven på hele stakken via dkc-018/apply.sh, som kæder dkc-015/apply.sh →
# dkc-014/apply.sh → … → DKC-001. DKC-018 er valgt som forudsætning, fordi den
# er den aktuelle stak-top.
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

echo "1/2 Lægger DKC-001 .. DKC-015 + DKC-018 (forudsætninger)"
"$OUTPUT/dkc-018/apply.sh" "$TARGET" >/dev/null

echo "2/2 Lægger DKC-064 fra $OVERLAY"
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
echo "  make validate && make lint && make test"
echo "  make vulnerability-check && make vulnerability-test"
echo "  make supply-chain-check && make supply-chain-test"
echo "  make release-check && make release-test"
echo "  make vulnerability-scan   # NOT RUN uden scannerbinærer og staging"
echo "  make baseline"
