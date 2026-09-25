#!/usr/bin/env bash
#
# Læg DKC-037-overlayen oven på en checkout, hvor DKC-001 .. DKC-013, DKC-055 og
# DKC-012 alle er lagt.
#
#   ./apply.sh /sti/til/checkout/00-core
#
# DKC-037 afhænger formelt af DKC-002 (arkitektur- og identitetskontrakter,
# deployment-profiler). Den lægges oven på hele den nuværende stak via
# dkc-012/apply.sh, som kæder dkc-013/apply.sh og dermed DKC-001 .. DKC-013 +
# DKC-055. DKC-012 er valgt som forudsætning, fordi den er den aktuelle
# stak-top.
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

echo "1/2 Lægger DKC-001 .. DKC-013 + DKC-012 + DKC-055 (forudsætninger)"
"$OUTPUT/dkc-012/apply.sh" "$TARGET" >/dev/null

echo "2/2 Lægger DKC-037 fra $OVERLAY"
( cd "$OVERLAY" && find . -type f -print0 ) | while IFS= read -r -d '' rel; do
  rel="${rel#./}"
  dest="$TARGET/$rel"
  mkdir -p "$(dirname "$dest")"
  cp "$OVERLAY/$rel" "$dest"
  echo "  → $rel"
done

echo
echo "Færdig. Kør i målet:"
echo "  make install"
echo "  make continuity-check && make continuity-test"
echo "  make validate && make architecture-check && make architecture-test"
echo "  make lint && make test"
echo "  make observability-check && make gitops-verify"
echo "  make baseline-test && make baseline"
