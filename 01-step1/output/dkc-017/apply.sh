#!/usr/bin/env bash
#
# Læg DKC-017-overlayen oven på en checkout, hvor hele den nuværende stak
# (DKC-001 .. DKC-057) allerede er lagt.
#
#   ./apply.sh /sti/til/checkout/00-core
#
# DKC-017 afhænger formelt af DKC-009 og DKC-015. Den lægges oven på hele
# stakken via dkc-057/apply.sh, som kæder dkc-016/apply.sh → dkc-020/apply.sh →
# dkc-024/apply.sh → dkc-023/apply.sh → … → DKC-001.
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

echo "1/2 Lægger DKC-001 .. DKC-057 (forudsætninger)"
"$OUTPUT/dkc-057/apply.sh" "$TARGET" >/dev/null

echo "2/2 Lægger DKC-017 fra $OVERLAY"
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
echo "  make validate && make lint"
echo "  make monitoring-check && make monitoring-test && make monitoring-drill"
echo "  make observability-check && make security-check"
echo "  make release-check && make release-test"
echo "  make supply-chain-check && make supply-chain-test"
echo "  make test"
echo "  make baseline"
