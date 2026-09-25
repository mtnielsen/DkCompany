#!/usr/bin/env bash
#
# Læg DKC-044-overlayen oven på en checkout, hvor hele den nuværende stak
# (stak-tip DKC-026 og alle forudsætninger) allerede er lagt.
#
#   ./apply.sh /sti/til/checkout/00-core
#
# DKC-044 afhænger formelt af DKC-017 (overvågning og hændelseshåndtering),
# DKC-025 (portal og kundelivscyklus) og DKC-037 (serviceklasser og recoverymål).
# Den lægges oven på hele stakken via dkc-026/apply.sh, som kæder
# dkc-025/apply.sh → dkc-022/apply.sh → … → DKC-001.
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

echo "1/2 Lægger stak-tippet DKC-026 og alle forudsætninger"
"$OUTPUT/dkc-026/apply.sh" "$TARGET" >/dev/null

echo "2/2 Lægger DKC-044 fra $OVERLAY"
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
echo "  make itsm-adapter-test && make itsm-adapter-demo"
echo "  make itsm-adapter-evidence"
echo "  make adapter-sdk-check && make adapter-sdk-test"
echo "  make adapter-test && make iam-adapter-test && make nextcloud-adapter-test"
echo "  make release-check && make release-test"
echo "  make supply-chain-check && make evidence-mode-check"
echo "  make data-register-check && make observability-check"
echo "  make continuity-check && make continuity-test"
echo "  make gitops-verify && make infrastructure-verify"
echo "  make test"
