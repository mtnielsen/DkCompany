#!/usr/bin/env bash
#
# Læg DKC-020-overlayen oven på en checkout, hvor hele den nuværende stak
# (DKC-001 .. DKC-024) allerede er lagt.
#
#   ./apply.sh /sti/til/checkout/00-core
#
# DKC-020 afhænger formelt af DKC-013, DKC-019 og DKC-024. Den lægges oven på
# hele stakken via dkc-024/apply.sh, som kæder dkc-023/apply.sh →
# dkc-064/apply.sh → dkc-018/apply.sh → dkc-015/apply.sh → … → DKC-001.
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

echo "1/2 Lægger DKC-001 .. DKC-024 (forudsætninger)"
"$OUTPUT/dkc-024/apply.sh" "$TARGET" >/dev/null

echo "2/2 Lægger DKC-020 fra $OVERLAY"
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
echo "  make privacy-check && make privacy-test && make privacy-run"
echo "  make persistence-check && make persistence-test"
echo "  make release-check && make release-test"
echo "  make supply-chain-check && make supply-chain-test"
echo "  make adapter-test && make iam-adapter-test && make test"
echo "  make baseline"
