#!/usr/bin/env bash
#
# Læg DKC-052-overlayen oven på en checkout, hvor hele den nuværende stak
# (stak-tip DKC-032 og alle forudsætninger) allerede er lagt.
#
#   ./apply.sh /sti/til/checkout/00-core
#
# DKC-052 (beredskabsøvelser og overtagelseskontrol) afhænger formelt af
# DKC-022 (evidens- og risikoregister samt brudøvelse), DKC-032 (AI i
# skyggetilstand og begrænset autonomi), DKC-044 (sammenhængende ITSM med
# menneskelige ejere), DKC-045 (menneskestyret change og runbooks) og DKC-051
# (fejl- og katastrofematrix). Overlayen lægges oven på hele stakken via
# dkc-032/apply.sh, som kæder dkc-051/apply.sh → dkc-050/apply.sh →
# dkc-027/apply.sh → … → dkc-001/apply.sh. Den genbruger desuden DKC-037
# (serviceklasser), DKC-038 (HA), DKC-039 (database-HA), DKC-041 (lager) og
# DKC-042 (uafhængig backup/DR).
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

echo "1/2 Lægger stak-tippet DKC-032 og alle forudsætninger"
"$OUTPUT/dkc-032/apply.sh" "$TARGET" >/dev/null

echo "2/2 Lægger DKC-052 fra $OVERLAY"
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
echo "  make takeover-run && make takeover-check && make takeover-test"
echo "  make validate && make lint"
echo "  make release-check && make release-test"
echo "  make continuity-test && make curriculum-test"
echo "  make conform-all"
echo "  make baseline-test"
echo "  make test"
