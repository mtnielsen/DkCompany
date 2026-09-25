#!/usr/bin/env bash
#
# Læg DKC-053-overlayen oven på en checkout, hvor hele den nuværende stak
# (DKC-001 .. DKC-013 + DKC-055 + DKC-012 + DKC-037) allerede er lagt.
#
#   ./apply.sh /sti/til/checkout/00-core
#
# DKC-053 afhænger formelt af DKC-002 (deployment-profiler) og DKC-037
# (serviceklasser). Den lægges oven på hele stakken via dkc-037/apply.sh, som
# kæder dkc-012/apply.sh og dermed DKC-001 .. DKC-013 + DKC-055. DKC-037 er
# valgt som forudsætning, fordi den er den aktuelle stak-top.
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

echo "1/2 Lægger DKC-001 .. DKC-013 + DKC-055 + DKC-012 + DKC-037 (forudsætninger)"
"$OUTPUT/dkc-037/apply.sh" "$TARGET" >/dev/null

echo "2/2 Lægger DKC-053 fra $OVERLAY"
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
echo "  make distribution-check && make distribution-test"
echo "  make distribution-preview PROFILE=small-vps APPS=bi"
echo "  make validate && make architecture-check && make continuity-check"
echo "  make lint && make test"
echo "  make baseline-test && make baseline"
