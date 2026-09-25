#!/usr/bin/env bash
#
# Læg DKC-034-overlayen oven på en checkout, hvor hele den nuværende stak
# (stak-tip DKC-052 og alle forudsætninger) allerede er lagt.
#
#   ./apply.sh /sti/til/checkout/00-core
#
# DKC-034 (forbrugs- og driftsomkostningsmåling) afhænger formelt af
# DKC-002 (deployments- og identitetskontrakter), DKC-017 (reel overvågning og
# hændelseshåndtering) og DKC-025 (portal og kundens livscyklus med
# servicepakker og pris). Overlayen lægges oven på hele stakken via
# dkc-052/apply.sh, som kæder dkc-032/apply.sh → dkc-051/apply.sh →
# dkc-050/apply.sh → … → dkc-001/apply.sh. Den genbruger desuden DKC-006
# (tenant-kontekst) og DKC-050 (enhedspris/kapacitetsmodel).
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

echo "1/2 Lægger stak-tippet DKC-052 og alle forudsætninger"
"$OUTPUT/dkc-052/apply.sh" "$TARGET" >/dev/null

echo "2/2 Lægger DKC-034 fra $OVERLAY"
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
echo "  make metering-render && make metering-run && make metering-check && make metering-test"
echo "  make validate && make lint"
echo "  make release-check && make release-test"
echo "  make supply-chain-check"
echo "  make conform-all"
echo "  make test && make baseline-test"
echo "  make baseline   # forventer 224 checks: 174 PASS, 1 kendt FAIL (changelog-check), 49 NOT RUN"
