#!/usr/bin/env bash
#
# Læg DKC-061-overlayen oven på en checkout, hvor hele den nuværende stak
# (stak-tip DKC-059 og alle forudsætninger) allerede er lagt.
#
#   ./apply.sh /sti/til/checkout/00-core
#
# DKC-061 (opdatering, fjernelse, support og offline-drift) afhænger formelt af
# DKC-014 (reproducerbare artefakter), DKC-031 (migrations- og exitværktøjer),
# DKC-053 (installationsprofiler og dependency-resolver), DKC-054 (installer og
# fælles konfiguration), DKC-057 (eksterne backupmål) og DKC-059
# (providerkontrakter og migrationskontrol). Overlayen lægges oven på hele
# stakken via dkc-059/apply.sh, som kæder dkc-031/apply.sh → dkc-030/apply.sh →
# … → dkc-001/apply.sh.
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

echo "1/2 Lægger stak-tippet DKC-059 og alle forudsætninger"
"$OUTPUT/dkc-059/apply.sh" "$TARGET" >/dev/null

echo "2/2 Lægger DKC-061 fra $OVERLAY"
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
echo "  make lifecycle-check && make lifecycle-test && make lifecycle-run"
echo "  make lifecycle-render && make lifecycle-report"
echo "  make validate && make lint"
echo "  make release-check && make release-test"
echo "  make distribution-check"
echo "  make supply-chain-check"
echo "  make test && make baseline-test"
echo "  make baseline   # forventer 254 checks: 198 PASS, 1 kendt FAIL (changelog-check), 55 NOT RUN"
