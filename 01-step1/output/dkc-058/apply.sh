#!/usr/bin/env bash
#
# Læg DKC-058-overlayen oven på en checkout, hvor hele den nuværende stak
# (stak-tip DKC-054 og alle forudsætninger) allerede er lagt.
#
#   ./apply.sh /sti/til/checkout/00-core
#
# DKC-058 afhænger formelt af DKC-010 (scoped credentials), DKC-014
# (reproducerbare artefakter), DKC-045 (menneskestyret change/runbooks), DKC-048
# (immutable data uden for agentens kontrol), DKC-053 (platformmatrix) og DKC-055
# (én rolle pr. agent). Overlayen lægges oven på hele stakken via
# dkc-054/apply.sh, som kæder dkc-046/apply.sh → … → dkc-001/apply.sh. Den
# genbruger desuden DKC-047 (beskyttede dataklasser) og DKC-054 (host-scope).
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

echo "1/2 Lægger stak-tippet DKC-054 og alle forudsætninger"
"$OUTPUT/dkc-054/apply.sh" "$TARGET" >/dev/null

echo "2/2 Lægger DKC-058 fra $OVERLAY"
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
echo "  make host-management-check && make host-management-test"
echo "  make host-management-status"
echo "  make runbook-check && make runbook-test"
echo "  make distribution-check && make distribution-test"
echo "  make release-check && make release-test"
echo "  make gitops-verify && make gitops-reconcile"
echo "  make baseline-test"
echo "  make test"
