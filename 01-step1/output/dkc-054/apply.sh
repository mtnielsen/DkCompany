#!/usr/bin/env bash
#
# Læg DKC-054-overlayen oven på en checkout, hvor hele den nuværende stak
# (stak-tip DKC-046 og alle forudsætninger) allerede er lagt.
#
#   ./apply.sh /sti/til/checkout/00-core
#
# DKC-054 afhænger formelt af DKC-006 (kundeadskillelse), DKC-014
# (reproducerbare artefakter), DKC-019 (dataregister/retention), DKC-025
# (portal og kundelivscyklus) og DKC-053 (installationsprofiler/resolver).
# Overlayen lægges oven på hele stakken via dkc-046/apply.sh, som kæder
# dkc-045/apply.sh → … → dkc-001/apply.sh. Den genbruger desuden DKC-045
# (menneskestyret change/runbooks), DKC-049 (logging), DKC-048 (immutable) og
# DKC-055 (én rolle pr. agent).
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

echo "1/2 Lægger stak-tippet DKC-046 og alle forudsætninger"
"$OUTPUT/dkc-046/apply.sh" "$TARGET" >/dev/null

echo "2/2 Lægger DKC-054 fra $OVERLAY"
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
echo "  make configuration-check && make configuration-test"
echo "  make configuration-preview && make installer-preflight && make installer-plan"
echo "  make portal-check && make portal-test"
echo "  make release-check && make release-test"
echo "  make distribution-check && make distribution-test"
echo "  make baseline-test"
echo "  make test"
