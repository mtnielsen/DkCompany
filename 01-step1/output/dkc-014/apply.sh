#!/usr/bin/env bash
#
# Læg DKC-014-overlayen oven på en checkout, hvor hele den nuværende stak
# (DKC-001 .. DKC-013 + DKC-055 + DKC-012 + DKC-037 + DKC-053 + DKC-063 +
# DKC-019 + DKC-047 + DKC-056) allerede er lagt.
#
#   ./apply.sh /sti/til/checkout/00-core
#
# DKC-014 afhænger formelt af DKC-001, DKC-002 og DKC-063. Den lægges oven på
# hele stakken via dkc-056/apply.sh, som kæder dkc-047/apply.sh → dkc-019/apply.sh
# → dkc-063/apply.sh → … → DKC-001. DKC-056 er valgt som forudsætning, fordi den
# er den aktuelle stak-top.
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

echo "1/2 Lægger DKC-001 .. DKC-013 + DKC-055 + DKC-012 + DKC-037 + DKC-053 + DKC-063 + DKC-019 + DKC-047 + DKC-056 (forudsætninger)"
"$OUTPUT/dkc-056/apply.sh" "$TARGET" >/dev/null

echo "2/2 Lægger DKC-014 fra $OVERLAY"
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
echo "  make validate && make lint && make test"
echo "  make supply-chain-sbom && make supply-chain-check"
echo "  make supply-chain-test && make supply-chain-vuln-check"
echo "  make supply-chain-verify   # blokerer indtil rigtige digests er pinnet"
echo "  make baseline"
