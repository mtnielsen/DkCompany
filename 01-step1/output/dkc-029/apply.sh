#!/usr/bin/env bash
#
# Læg DKC-029-overlayen oven på en checkout, hvor hele den nuværende stak
# (stak-tip DKC-028 og alle forudsætninger) allerede er lagt.
#
#   ./apply.sh /sti/til/checkout/00-core
#
# DKC-029 (support og sagsbehandling) afhænger formelt af DKC-021 (sletning,
# legal hold og gendannelsesregler), DKC-023 (fælles adapter-SDK) og DKC-025
# (portal og kundens livscyklus). Overlayen lægges oven på hele stakken via
# dkc-028/apply.sh, som kæder dkc-034/apply.sh → dkc-052/apply.sh →
# dkc-032/apply.sh → … → dkc-001/apply.sh. Den genbruger desuden DKC-011
# (værktøjsgrænse og injektionssignal), DKC-006 (tenant-kontekst) og DKC-007
# (deterministisk digest).
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

echo "1/2 Lægger stak-tippet DKC-028 og alle forudsætninger"
"$OUTPUT/dkc-028/apply.sh" "$TARGET" >/dev/null

echo "2/2 Lægger DKC-029 fra $OVERLAY"
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
echo "  make helpdesk-run && make helpdesk-check && make helpdesk-test"
echo "  make helpdesk-render && make helpdesk-report"
echo "  make validate && make lint"
echo "  make release-check && make release-test"
echo "  make supply-chain-check"
echo "  make conform-all"
echo "  make test && make baseline-test"
echo "  make baseline   # forventer 234 checks: 182 PASS, 1 kendt FAIL (changelog-check), 51 NOT RUN"
