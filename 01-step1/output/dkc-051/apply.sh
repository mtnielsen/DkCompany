#!/usr/bin/env bash
#
# Læg DKC-051-overlayen oven på en checkout, hvor hele den nuværende stak
# (stak-tip DKC-050 og alle forudsætninger) allerede er lagt.
#
#   ./apply.sh /sti/til/checkout/00-core
#
# DKC-051 afhænger formelt af DKC-042 (uafhængig backup, PITR og
# katastrofegendannelse), DKC-043 (sikker deduplikering og kontrolleret
# oprydning), DKC-046 (begrænset selvreparation), DKC-049 (komplet logging) og
# DKC-050 (kapacitet og vandret skalering). Overlayen lægges oven på hele
# stakken via dkc-050/apply.sh, som kæder dkc-027/apply.sh → dkc-058/apply.sh →
# … → dkc-001/apply.sh. Den genbruger desuden DKC-038 (HA-klynge), DKC-039
# (database-HA), DKC-040 (beskeder og jobkø), DKC-041 (holdbart fil- og
# objektlager) og DKC-048 (immutable data).
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

echo "1/2 Lægger stak-tippet DKC-050 og alle forudsætninger"
"$OUTPUT/dkc-050/apply.sh" "$TARGET" >/dev/null

echo "2/2 Lægger DKC-051 fra $OVERLAY"
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
echo "  make chaos-run && make chaos-check && make chaos-test"
echo "  make release-check && make release-test"
echo "  make supply-chain-check"
echo "  make dr-check && make dedup-check && make remediation-check"
echo "  make ha-check && make db-ha-check && make storage-check"
echo "  make observability-check && make data-register-check"
echo "  make gitops-verify && make infrastructure-verify"
echo "  make conform-all"
echo "  make baseline-test"
echo "  make test"
