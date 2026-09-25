#!/usr/bin/env bash
#
# Læg DKC-047-overlayen oven på en checkout, hvor hele den nuværende stak
# (DKC-001 .. DKC-013 + DKC-055 + DKC-012 + DKC-037 + DKC-053 + DKC-063 +
# DKC-019) allerede er lagt.
#
#   ./apply.sh /sti/til/checkout/00-core
#
# DKC-047 afhænger formelt af DKC-007, DKC-019 og DKC-037. Den lægges oven på
# hele stakken via dkc-019/apply.sh, som kæder dkc-063/apply.sh og dermed
# DKC-001 .. DKC-013 + DKC-055 + DKC-012 + DKC-037 + DKC-053 + DKC-063.
# DKC-019 er valgt som forudsætning, fordi den er den aktuelle stak-top.
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

echo "1/2 Lægger DKC-001 .. DKC-013 + DKC-055 + DKC-012 + DKC-037 + DKC-053 + DKC-063 + DKC-019 (forudsætninger)"
"$OUTPUT/dkc-019/apply.sh" "$TARGET" >/dev/null

echo "2/2 Lægger DKC-047 fra $OVERLAY"
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
echo "  make data-protection-check && make data-protection-test"
echo "  make validate && make lint && make test"
echo "  make baseline"
