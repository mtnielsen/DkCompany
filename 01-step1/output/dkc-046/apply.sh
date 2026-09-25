#!/usr/bin/env bash
#
# Læg DKC-046-overlayen oven på en checkout, hvor hele den nuværende stak
# (stak-tip DKC-045 og alle forudsætninger) allerede er lagt.
#
#   ./apply.sh /sti/til/checkout/00-core
#
# DKC-046 afhænger formelt af DKC-010 (nødstop), DKC-011 (værktøjsgrænse),
# DKC-013 (handlingsklasser/reconciliation), DKC-017 (overvågning), DKC-038 (HA),
# DKC-045 (signerede runbooks/change-service), DKC-048 (immutable data) og
# DKC-055 (én rolle pr. agent). Den lægges oven på hele stakken via
# dkc-045/apply.sh, som kæder dkc-044/apply.sh → … → DKC-001.
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

echo "1/2 Lægger stak-tippet DKC-045 og alle forudsætninger"
"$OUTPUT/dkc-045/apply.sh" "$TARGET" >/dev/null

echo "2/2 Lægger DKC-046 fra $OVERLAY"
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
echo "  make remediation-check && make remediation-test"
echo "  make runbook-check && make runbook-test"
echo "  make runtime-test && make approval-test && make boundary-test"
echo "  make release-check && make release-test"
echo "  make evidence-mode-check && make baseline-test"
echo "  make test"
