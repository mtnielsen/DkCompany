#!/usr/bin/env bash
#
# Læg DKC-045-overlayen oven på en checkout, hvor hele den nuværende stak
# (stak-tip DKC-044 og alle forudsætninger) allerede er lagt.
#
#   ./apply.sh /sti/til/checkout/00-core
#
# DKC-045 afhænger formelt af DKC-004 og DKC-005 (autentiske, ændringsbundne
# godkendelser), DKC-014 (signerede artefakter), DKC-044 (ITSM/change) og
# DKC-055 (én uforanderlig rolle pr. agent). Den lægges oven på hele stakken via
# dkc-044/apply.sh, som kæder dkc-026/apply.sh → … → DKC-001.
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

echo "1/2 Lægger stak-tippet DKC-044 og alle forudsætninger"
"$OUTPUT/dkc-044/apply.sh" "$TARGET" >/dev/null

echo "2/2 Lægger DKC-045 fra $OVERLAY"
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
echo "  make runbook-check && make runbook-test"
echo "  make approval-test && make runtime-test && make boundary-test"
echo "  make release-check && make release-test"
echo "  make data-register-check && make observability-check"
echo "  make evidence-mode-check && make baseline-test"
echo "  make test"
