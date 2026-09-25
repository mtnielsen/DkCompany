#!/usr/bin/env bash
#
# Læg DKC-018-overlayen oven på en checkout, hvor hele den nuværende stak
# (DKC-001 .. DKC-013 + DKC-055 + DKC-012 + DKC-037 + DKC-053 + DKC-063 +
# DKC-019 + DKC-047 + DKC-056 + DKC-014 + DKC-015) allerede er lagt.
#
#   ./apply.sh /sti/til/checkout/00-core
#
# DKC-018 afhænger formelt af DKC-007, DKC-015 og DKC-063. Den lægges oven på
# hele stakken via dkc-015/apply.sh, som kæder dkc-014/apply.sh → … → DKC-001.
# DKC-015 er valgt som forudsætning, fordi den er den aktuelle stak-top.
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

echo "1/2 Lægger DKC-001 .. DKC-013 + DKC-055 + DKC-012 + DKC-037 + DKC-053 + DKC-063 + DKC-019 + DKC-047 + DKC-056 + DKC-014 + DKC-015 (forudsætninger)"
"$OUTPUT/dkc-015/apply.sh" "$TARGET" >/dev/null

echo "2/2 Lægger DKC-018 fra $OVERLAY"
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
echo "  make evidence-mode-check && make evidence-mode-test"
echo "  make release-check && make release-test"
echo "  make evidence-probe   # NOT RUN uden DKC_PROBE_* og levende endpoints"
echo "  make baseline"
