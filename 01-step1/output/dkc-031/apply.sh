#!/usr/bin/env bash
#
# Læg DKC-031-overlayen oven på en checkout, hvor hele den nuværende stak
# (stak-tip DKC-030 og alle forudsætninger) allerede er lagt.
#
#   ./apply.sh /sti/til/checkout/00-core
#
# DKC-031 (migrations- og exitværktøjer) afhænger formelt af DKC-020 (DSAR og
# eksport), DKC-025 (portal og kundens livscyklus), DKC-026 (filer/Nextcloud),
# DKC-027 (projekt/OpenProject), DKC-028 (videnssøgning/BookStack), DKC-029
# (support/Zammad) og DKC-030 (CRM/EspoCRM). Overlayen lægges oven på hele
# stakken via dkc-030/apply.sh, som kæder dkc-029/apply.sh → dkc-028/apply.sh →
# … → dkc-001/apply.sh. Den genbruger desuden DKC-043 (dedup og kontrolleret
# oprydning) og DKC-007 (deterministisk digest).
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

echo "1/2 Lægger stak-tippet DKC-030 og alle forudsætninger"
"$OUTPUT/dkc-030/apply.sh" "$TARGET" >/dev/null

echo "2/2 Lægger DKC-031 fra $OVERLAY"
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
echo "  make migration-check && make migration-test && make migration-run"
echo "  make migration-dry-run && make migration-render && make migration-report"
echo "  make validate && make lint"
echo "  make release-check && make release-test"
echo "  make supply-chain-check"
echo "  make conform-all"
echo "  make test && make baseline-test"
echo "  make baseline   # forventer 244 checks: 190 PASS, 1 kendt FAIL (changelog-check), 53 NOT RUN"
