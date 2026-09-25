# Runbooks

Denne mappe er det versionsstyrede katalog over **signerede runbooks**. En
runbook er ikke en fri vejledning: den er den præcise kontrakt, en
forhåndsgodkendt selvreparation må udføre inden for.

## Indhold

| Fil | Formål |
| --- | --- |
| `registry.json` | Katalog over runbooks med `ref`, `digest`, flow og kildekontrakt. |
| `dev-keyring.json` | Syntetisk udviklingsnøglesæt. **Må aldrig bruges i produktion.** |
| `sign.mjs` | Signerer en runbook med `RUNBOOK_SIGNING_KEY` fra miljøet. |

Selve runbook-dokumentet valideres mod `contracts/runbook.schema.json` og de
semantiske regler i `approvals/src/runbook.mjs`. Et eksempel findes i
`contracts/examples/runbook.example.json`.

## Signatur

Signaturen er en HMAC-SHA256 over hele det kanoniske indhold undtagen
`signature`-feltet selv. Verifikationen:

```bash
node --no-warnings -e '
import { verifyRunbookSignature } from "./approvals/src/runbook.mjs";
import { readFileSync } from "node:fs";
const rb = JSON.parse(readFileSync("contracts/examples/runbook.example.json", "utf8"));
const keyring = JSON.parse(readFileSync("runbooks/dev-keyring.json", "utf8"));
console.log(verifyRunbookSignature(rb, keyring));
'
```

I produktion leveres nøglen af KMS/HSM. En manglende, ukendt eller tilbagekaldt
nøgle afvises altid, og en runbook uden gyldig signatur må ikke eksekveres.

## Forhåndsgodkendelse

En standard-runbook bliver først bindende, når en menneskelig godkendelse (via
`approvals/`) er bundet til **netop dens digest**. Det gør
`createChangeService().approveRunbook(...)`. En ny version eller et større scope
giver en ny digest, og dermed kræves en ny godkendelse. Se
`docs/runbooks/runbook-approval.md` og `docs/spec/change-and-runbooks.md`.
