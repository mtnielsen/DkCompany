#!/usr/bin/env bash
#
# Læg DKC-001-overlayen oven på en ren checkout af repositoryet.
#
#   ./apply.sh /sti/til/repo
#
# Overlayen indeholder:
#   - tools/baseline/                     baselineværktøjet
#   - Makefile                            med `baseline`-targets
#   - README.md                           rettet modenhedssprog
#   - docs/spec/security-plan.md          rettet CI-/scannerpåstande
#   - docs/spec/reference-module.md       rettet deploy-/in-processpåstande
#   - docs/status/implementation-matrix.md genereret matrix
#
# Scriptet rører ikke 00-core/ i denne pakke; det skriver kun til det angivne mål.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OVERLAY="$HERE/deliverable"
TARGET="${1:-}"

if [[ -z "$TARGET" ]]; then
  echo "Brug: $0 <sti-til-repo-rod>" >&2
  exit 2
fi
if [[ ! -d "$TARGET" ]]; then
  echo "Målet findes ikke: $TARGET" >&2
  exit 2
fi

echo "Lægger overlay fra $OVERLAY på $TARGET"
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
echo "  make baseline-test"
echo "  make baseline"
