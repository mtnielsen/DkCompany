#!/usr/bin/env bash
#
# Læg DKC-023-overlayen oven på en checkout, hvor hele den nuværende stak
# (DKC-001 .. DKC-064) allerede er lagt.
#
#   ./apply.sh /sti/til/checkout/00-core
#
# DKC-023 afhænger formelt af DKC-002, DKC-006, DKC-007, DKC-018, DKC-019,
# DKC-037, DKC-047 og DKC-053. Den lægges oven på hele stakken via
# dkc-064/apply.sh, som kæder dkc-018/apply.sh → dkc-015/apply.sh → … → DKC-001.
# DKC-064 er valgt som forudsætning, fordi den er den aktuelle stak-top.
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

echo "1/2 Lægger DKC-001 .. DKC-064 (forudsætninger)"
"$OUTPUT/dkc-064/apply.sh" "$TARGET" >/dev/null

echo "2/2 Lægger DKC-023 fra $OVERLAY"
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
echo "  make adapter-sdk-check && make adapter-sdk-test"
echo "  make adapter-test && make iam-adapter-test"
echo "  make persistence-check && make release-check && make release-test"
echo "  make supply-chain-check && make supply-chain-test"
echo "  make conform-all && make conform-negative"
echo "  make baseline"
