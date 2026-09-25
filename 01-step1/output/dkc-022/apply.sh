#!/usr/bin/env bash
#
# Læg DKC-022-overlayen oven på en checkout, hvor hele den nuværende stak
# (DKC-001 .. DKC-021 og DKC-023/024/037..043/047..049/053/055..057/060/063/064/066)
# allerede er lagt.
#
#   ./apply.sh /sti/til/checkout/00-core
#
# DKC-022 afhænger formelt af DKC-017 (overvågning), DKC-018 (evidensmodes),
# DKC-019 (dataregister), DKC-021 (sletning/legal hold) og DKC-047 (beskyttede
# dataklasser). Den lægges oven på hele stakken via dkc-043/apply.sh, som kæder
# dkc-042/apply.sh → dkc-049/apply.sh → dkc-021/apply.sh → … → DKC-001.
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

echo "1/2 Lægger DKC-001 .. DKC-043 og øvrige forudsætninger (stak-tip DKC-043)"
"$OUTPUT/dkc-043/apply.sh" "$TARGET" >/dev/null

echo "2/2 Lægger DKC-022 fra $OVERLAY"
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
echo "  make assurance-write && make assurance-check && make assurance-test"
echo "  make assurance-export"
echo "  make compliance-check && make data-register-check"
echo "  make release-check && make release-test"
echo "  make evidence-mode-check"
echo "  make supply-chain-check"
echo "  make test"
echo "  make baseline"
