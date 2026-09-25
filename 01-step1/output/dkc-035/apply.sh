#!/usr/bin/env bash
#
# Læg DKC-035-overlayen oven på en checkout, hvor hele den nuværende stak
# (stak-tip DKC-033 og alle forudsætninger) allerede er lagt.
#
#   ./apply.sh /sti/til/checkout/00-core
#
# DKC-035 (modulregistrering for økonomi, HR og handel) afhænger formelt af
# DKC-022, DKC-023, DKC-030, DKC-033 og DKC-034. Overlayen lægges oven på hele
# stakken via dkc-033/apply.sh, som kæder dkc-065/apply.sh → … → dkc-001/apply.sh.
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

echo "1/2 Lægger stak-tippet DKC-033 og alle forudsætninger"
"$OUTPUT/dkc-033/apply.sh" "$TARGET" >/dev/null

echo "2/2 Lægger DKC-035 fra $OVERLAY"
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
echo "  make localization-check && make localization-test && make localization-run"
echo "  make localization-render && make localization-check"
echo "  make distribution-check"
echo "  make validate && make lint"
echo "  make release-check"
echo "  make test"
echo "  make baseline   # forventer 274 checks: 214 PASS, 1 kendt FAIL (changelog-check), 59 NOT RUN"
