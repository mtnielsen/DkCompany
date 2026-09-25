#!/usr/bin/env bash
#
# Læg DKC-025-overlayen oven på en checkout, hvor hele den nuværende stak
# (stak-tip DKC-022 og alle forudsætninger) allerede er lagt.
#
#   ./apply.sh /sti/til/checkout/00-core
#
# DKC-025 afhænger formelt af DKC-004 (godkendelser), DKC-006
# (kundeadskillelse), DKC-013 (genoptagelig eksekvering), DKC-015 (GitOps) og
# DKC-023 (adapterværktøjer). Den lægges oven på hele stakken via
# dkc-022/apply.sh, som kæder dkc-043/apply.sh → dkc-042/apply.sh → … → DKC-001.
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

echo "1/2 Lægger stak-tippet DKC-022 og alle forudsætninger"
"$OUTPUT/dkc-022/apply.sh" "$TARGET" >/dev/null

echo "2/2 Lægger DKC-025 fra $OVERLAY"
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
echo "  make portal-write && make portal-check && make portal-test"
echo "  make portal-preview && make portal-demo"
echo "  make persistence-check && make persistence-test"
echo "  make release-check && make release-test"
echo "  make supply-chain-check && make evidence-mode-check"
echo "  make test"
echo "  make baseline"
