# Runbook: autoriseret break-glass

Break-glass er en **tidsbegrænset, godkendt, scope-bundet** undtagelse fra den
normale ændringsvej — ikke en permanent nøgle og ikke en agent-handling.

## Regler

- Rekvirenten skal være et verificeret **menneske**; en agent kan hverken anmode eller godkende.
- Godkenderen skal være et navngivet menneske og **må ikke være den samme** som rekvirenten.
- Scope skal være et af: `read-audit`, `restart-workload`, `rotate-credential`, `restore-backup`, `drain-node`.
- Varigheden er højst `maxDurationMinutes` fra planen (120 minutter for staging).
- Der kræves en skriftlig begrundelse.
- Tilladelsen udløber automatisk og efterlader et audit-spor.

## Anmodning

```json
{
  "requester": { "subject": "oidc|anna.andersen", "kind": "human", "role": "Platform Operator" },
  "approver": { "subject": "oidc|cecilia.christensen", "kind": "human", "role": "Security Owner" },
  "scope": ["restart-workload"],
  "durationMinutes": 30,
  "reason": "Staging-node hænger under incident og skal genstartes."
}
```

```sh
make infrastructure-check
node infrastructure/src/cli.mjs break-glass --request request.json
```

`infrastructure/src/break-glass.mjs` returnerer en tilladelse med `expiresAt`,
`approvedBy`, `audit: true` og `contact` eller en liste af begrundelser.
Beslutningen håndhæves af identitet og ejerskab, ikke af en prompt.

## Efter break-glass

1. Luk hændelsen og bekræft, at tilstanden igen er i git.
2. Registrér handlingen i change loggen.
3. Fjern den midlertidige adgang, og verificér at nøglen ikke længere virker.
