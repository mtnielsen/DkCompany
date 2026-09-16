# ADR-0001: Fire planer som bindende kontrakter

- **Status:** accepteret
- **Beslutningstagere:** Platformsejerskab
- **Dato:** 2025-09-01
- **Beslutningsdrev:** Risikoen for over-specifikation ville gøre projektet til 120 kontrakter, der aldrig blev implementeret.

## Kontekst og problemstilling

Den oprindelige idé rummede omkring ti "planer" (identitet, telemetri, ops, privacy, policy, GitOps, sikkerhed, compliance, dashboards, læring) på tværs af et stort antal moduler. Med et sådant antal kontrakter ville ingen enkelt plan nogensinde nå en testbar tilstand. En spec uden en tilhørende konformanstest er i praksis en PDF, ingen følger.

Vi har brug for at vælge et mindste sæt planer, der tilsammen gør platformen styrbar og beviselig — og som kan implementeres og testes inden for overskuelig tid.

## Beslutningskriterier

- Planen skal kunne beskrives som en maskinlæsbar kontrakt (JSON Schema).
- Planen skal kunne testes deterministisk i CI.
- Planen skal være nødvendig for mindst ét reelt modul eller agentflow.
- Planer der kan udskydes uden at blokere de øvrige, må ikke bindes nu.

## Overvejede muligheder

- **Alle planer på én gang.** Fuld dækning, men ingen plan bliver færdig; over-specifikation.
- **Kun telemetri og identitet.** Nemt, men uden ops- og privacy-verber har platformen intet at orkestrere.
- **Fire planer: identitet, telemetri, ops-kontrakt, privacy.** Tilstrækkeligt til at et modul kan drives, overvåges og opfylde DSAR.
- **Fire planer plus policy.** Fristende, men policy er en selvstændig beslutning (se ADR-0002 og bølge 1).

## Beslutning

Vi binder fire planer som bindende kontrakter i `/contracts`:

1. **Identitetsplan** — OIDC (auth), SCIM 2.0 (provisionering), SPIFFE (workload). Intet modul har egen brugerdatabase.
2. **Telemetriplan** — OTel traces/metrics/logs og én CloudEvents-envelope med obligatorisk `tenantid`, `traceid` og `principal`.
3. **Ops-kontrakt** — et fast verbsæt med conformance-niveau pr. verbum.
4. **Privacy-verber** — `subject.locate`, `subject.export`, `subject.erase`, `subject.legal_hold`, `retention.policy` som ét fan-out-kald.

De øvrige planer udskydes eksplicit og bindes først, når de fire er beviste mod virkeligheden (bølge 1). Policy-planen er den første kandidat, fordi den er forudsætning for agentautonomi.

## Konsekvenser

- **Positive:** Kontrakten er lille nok til at blive testet. Hvert modul kan erklære sig ærligt i stedet for at love fuld dækning.
- **Negative:** Policy, GitOps, sikkerhed og compliance står uden formel kontrakt indtil videre. Det accepteres — de kan ikke implementeres troværdigt uden de fire første.
- **Neutrale:** Nye planer skal fremover vedtages som en ADR og en schemablok, ikke som prosa.

## Mere information

- `BACKLOG.md` bølge 0–1
- `contracts/identity.schema.json`, `contracts/telemetry.schema.json`, `contracts/module-manifest.schema.json`, `contracts/privacy-request.schema.json`
- ADR-0002 (rækkefølge), ADR-0003 (partial conformance)
