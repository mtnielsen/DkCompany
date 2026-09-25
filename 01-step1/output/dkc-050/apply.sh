#!/usr/bin/env bash
#
# Læg DKC-050-overlayen oven på en checkout, hvor hele den nuværende stak
# (stak-tip DKC-027 og alle forudsætninger) allerede er lagt.
#
#   ./apply.sh /sti/til/checkout/00-core
#
# DKC-050 afhænger formelt af DKC-012 (modelgateway og budgetter), DKC-026
# (filer og kontorsamarbejde), DKC-027 (projektstyring), DKC-038 (HA-klynge),
# DKC-039 (database-HA), DKC-040 (beskeder og jobkø) og DKC-041 (holdbart
# fil- og objektlager). Overlayen lægges oven på hele stakken via
# dkc-027/apply.sh, som kæder dkc-058/apply.sh → dkc-054/apply.sh → … →
# dkc-001/apply.sh. Den genbruger desuden DKC-017 (overvågning), DKC-037
# (serviceklasser) og DKC-045 (signerede runbooks).
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

echo "1/2 Lægger stak-tippet DKC-027 og alle forudsætninger"
"$OUTPUT/dkc-027/apply.sh" "$TARGET" >/dev/null

echo "2/2 Lægger DKC-050 fra $OVERLAY"
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
echo "  make performance-render && make performance-check"
echo "  make performance-test && make performance-drill"
echo "  make runbook-check && make monitoring-check"
echo "  make release-check && make release-test"
echo "  make supply-chain-check"
echo "  make observability-check && make data-register-check"
echo "  make gitops-verify && make infrastructure-verify"
echo "  make conform-all"
echo "  make baseline-test"
echo "  make test"
