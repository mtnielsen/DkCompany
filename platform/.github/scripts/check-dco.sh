#!/usr/bin/env bash
# DCO-håndhævelse: enhver commit i range skal have en Signed-off-by-linje.
set -euo pipefail

range="${1:?brug: check-dco.sh <git-range>}"

base="${range%%..*}"
# Nye branches har en nul-SHA som 'before'. Fald tilbage til HEAD i stedet for at fejle.
if [[ "$base" == 0000000000000000000000000000000000000000* ]] || ! git rev-parse --quiet --verify "$base^{commit}" >/dev/null 2>&1; then
  echo "Range '$range' har ugyldig base; tjekker HEAD i stedet."
  commits="$(git log --format=%H -1 HEAD)"
else
  echo "Tjekker DCO-sign-off i range: $range"
  commits="$(git log --format=%H "$range")"
fi

missing=0
while IFS= read -r sha; do
  [[ -z "$sha" ]] && continue
  msg="$(git log -1 --format=%B "$sha")"
  if ! grep -qiE '^Signed-off-by: .+ <.+@.+>' <<<"$msg"; then
    echo "✘ $sha mangler 'Signed-off-by'"
    missing=1
  fi
done <<<"$commits"

if [[ "$missing" -ne 0 ]]; then
  echo ""
  echo "Alle commits skal signeres med 'git commit -s'. Se CONTRIBUTING.md."
  exit 1
fi

echo "✔ Alle commits i range er DCO-signeret"
