#!/usr/bin/env bash
#
# Læg DKC-027-overlayen oven på en checkout, hvor hele den nuværende stak
# (stak-tip DKC-058 og alle forudsætninger) allerede er lagt.
#
#   ./apply.sh /sti/til/checkout/00-core
#
# DKC-027 afhænger formelt af DKC-016 (backup og gendannelse), DKC-021 (sletning,
# legal hold og gendannelsesregler), DKC-023 (fælles adapterværktøjer) og DKC-025
# (portal og kundelivscyklus). Overlayen lægges oven på hele stakken via
# dkc-058/apply.sh, som kæder dkc-054/apply.sh → dkc-046/apply.sh → … →
# dkc-001/apply.sh. Den genbruger desuden DKC-011 (værktøjsgrænse), DKC-019
# (dataregister), DKC-048 (immutable data) og DKC-055 (én rolle pr. agent).
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

echo "1/2 Lægger stak-tippet DKC-058 og alle forudsætninger"
"$OUTPUT/dkc-058/apply.sh" "$TARGET" >/dev/null

echo "2/2 Lægger DKC-027 fra $OVERLAY"
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
echo "  make openproject-adapter-test && make openproject-adapter-demo"
echo "  make openproject-adapter-evidence"
echo "  make adapter-sdk-check && make adapter-sdk-test"
echo "  make release-check && make release-test"
echo "  make supply-chain-check"
echo "  make data-register-check && make observability-check"
echo "  make conform-all"
echo "  make gitops-verify && make infrastructure-verify"
echo "  make baseline-test"
echo "  make test"
