#!/usr/bin/env bash
#
# Læg DKC-032-overlayen oven på en checkout, hvor hele den nuværende stak
# (stak-tip DKC-051 og alle forudsætninger) allerede er lagt.
#
#   ./apply.sh /sti/til/checkout/00-core
#
# DKC-032 (AI i skyggetilstand og begrænset autonomi) afhænger formelt af
# DKC-005 (runtime verificerer godkendelser), DKC-010 (JIT-credentials og
# nødstop), DKC-011 (værktøjsgrænse og injection), DKC-012 (modelgateway og
# budgetter), DKC-013 (genoptagelig og idempotent eksekvering), DKC-017 (reel
# overvågning), DKC-024 (Keycloak/Mattermost), DKC-046 (begrænset
# selvreparation) og DKC-049 (komplet logging). Overlayen lægges oven på hele
# stakken via dkc-051/apply.sh, som kæder dkc-050/apply.sh → dkc-027/apply.sh →
# dkc-058/apply.sh → … → dkc-001/apply.sh. Den genbruger desuden DKC-045
# (runbooks og change-flow).
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

echo "1/2 Lægger stak-tippet DKC-051 og alle forudsætninger"
"$OUTPUT/dkc-051/apply.sh" "$TARGET" >/dev/null

echo "2/2 Lægger DKC-032 fra $OVERLAY"
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
echo "  make shadow-run && make shadow-check && make shadow-test"
echo "  make validate && make lint"
echo "  make release-check && make release-test"
echo "  make supply-chain-check"
echo "  make conform-all"
echo "  make baseline-test"
echo "  make test"
