# Runbook — gendannelse af immutable data

Formål: gendanne beskyttede data uden at omgå WORM-låse, retention eller
adgangsregler, og håndtere en kompromitteret agent eller appkonto.

## Forudsætninger

- Politikken i `data-protection/enforcement/immutable-policy.json` er gældende;
  `make immutable-check` bekræfter at den er konsistent.
- En navngivet security-admin og en separat godkender (to-personers).
- En kendt ren gendannelsespunktsreference.

## Kompromitteret agent/appkonto

1. Bekræft i audit-sporet at mutationen blev afvist (`immutable_forbidden`).
2. Spær den kompromitterede identitet.
3. Kør `make immutable-check` og verificér at object-lock, roller og manifester
   stadig er intakte.
4. Kør `make immutable-test` for at bekræfte at WORM-låse og retention ikke er
   ændret.

## Gendannelse der bevarer låse

1. Eksportér den beskyttede tilstand (`exportProtectedState`) — versioner, låse,
   autoritativ pointer og politikken.
2. Gendan i et rent lager (`importProtectedState`).
3. Verificér med `compareProtectedState` at versionsantal, autoritativ version og
   antallet af låse matcher.
4. Afvis gendannelsen hvis en lås er tabt; en gendannelse må ikke bruges til at
   omgå beskyttelsen.

## GOVERNANCE-bypass af en lås

1. Bekræft at låsen er GOVERNANCE, ikke COMPLIANCE. COMPLIANCE kan ikke brydes.
2. Indhent to-personers godkendelse fra en anden person end anmoderen.
3. Udfør sletningen med `bypassGovernance` og bekræft at den blev auditeret.

## Nøgler

1. Sletning af en KMS-nøgle kræver security-admin og en separat godkender.
2. En nøgle der stadig understøtter en retention-locked post må **ikke** slettes.
3. Rotation er tilladt, men gamle versioner bevares, så tidligere signaturer kan
   verificeres.

## Bevis

`make immutable-test` bekræfter object-lock, rolle-håndhævelse, nøglebeskyttelse,
backup/restore og den negative lagersemantik. Selvtesten er deterministisk
(`verifiedByHuman: false`). En målt WORM-verifikation på et levende
S3-/objektlager er `integration-immutable-live` og er NOT RUN i dette miljø.
