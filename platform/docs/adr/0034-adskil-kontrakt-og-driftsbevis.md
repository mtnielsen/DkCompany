# ADR-0034: Kontraktchecks, integration og driftsbevis adskilles med versioneret evidens

- **Status:** accepteret
- **Beslutningstagere:** Anna Andersen (Platform Owner), med Bo Bertelsen som stedfortræder
- **Dato:** 2026-09-23
- **Beslutningsdrev:** DKC-018. Et fixture-pass beviste, at et manifest *kan* validere — ikke at verbet *virker* i en rigtig deployment. Uden en maskinelt håndhævet forskel kunne en hurtig, grøn fixturekørsel blive læst som produktionsstatus. Vi skal kunne køre de hurtige kontraktchecks uden at forveksle dem med integration og drift.

## Kontekst og problemstilling

- **Blandede bevisniveauer.** Conformance-suiten havde niveauer (`fixture`, `contract`, `integration`, `real`), men en evidenspost bar ikke selv sit niveau, commit, image-digest, miljø, upstream-version, run-ID og udløb.
- **Genbrug på tværs af artefakter.** En post uden binding til commit og digest kan flyttes til en anden release.
- **Friskhed.** En gammel grøn kørsel kan fremstå som aktuel.
- **Manipulation.** Et JSON-dokument med `"result": "pass"` er ikke bevis; en manuel redigering må ikke kunne accepteres.
- **PDP-nedbrud.** Hvis PDP'en er frakoblet, må den faktiske mutation ikke ske.
- **Direkte endpoints.** Et kald uden om gatewayen må ikke kunne påstå identitet.
- **Miljøet.** Der er ingen kørende installation, PDP, audit-service eller gateway her. Integration/runtime-prober kan derfor ikke køres; de skal skrives som `not-run`, aldrig som `pass`.

## Beslutningskriterier

- Én versioneret evidenskontrakt med mode, commit, image-digest, miljø, upstream-version, run-ID, indsamlingstid og udløb.
- En semantisk validator, der afviser udløbet, fremtidsdateret, forkert-bundet og manuelt ændret evidens.
- Et produktionsbadge, der kræver et integration/runtime-bevis pr. påkrævet emne; fixture/contract kan højst give `fixture-only`.
- En probe-kører, der skriver `not-run` med begrundelse, når endpointet mangler eller ikke kan nås.
- Negative bypass-tests mod direkte endpoints, manglende PDP og forældet evidens.
- De hurtige fixturechecks bevares uændret.

## Overvejede muligheder

- **Kun dokumentation.** Hurtigt, men ingen håndhævelse.
- **Kun et nyt felt i prose-rapporten.** Kan ikke afvises maskinelt.
- **Versioneret evidenspost + badge-regel + probekører + negative tests.** Kræver vedligeholdelse, men gør forskellen mellem fixture og drift efterprøvelig i dag og ærlig i CI.

## Beslutning

Vi indfører en versioneret evidenspost, håndhævet i
`contracts/evidence-record.schema.json`, `conformance/src/evidence-mode.mjs`,
`conformance/src/evidence-mode-check.mjs`, `evidence/src/probes.mjs` og
`evidence/src/probe-cli.mjs`:

1. **Versioneret post.** `mode`, `commit`, `imageDigest`, `environment`, `upstreamVersion`, `runId`, `capturedAt`, `expiresAt` og `digest` er en del af posten.
2. **Tamper-evident digest.** `digest` er SHA-256 over postens kanoniske indhold uden `digest` og `signature`. En manuel ændring — fx `result: pass` — bryder digesten og afvises. En valgfri Ed25519-signatur binder digesten til et trust anchor.
3. **Produktionsbadge.** Hvert påkrævet emne skal have mindst ét integration/runtime-bevis, bundet til det præcise commit/image/miljø og uudløbet. Fixture/contract alene giver `fixture-only`.
4. **Prober.** `evidence/probes.json` erklærer integration/runtime-prober. Køreren skriver `not-run`, når endpointet ikke er konfigureret eller ikke kan nås; forventet deny er en eksplicit negativ probe.
5. **Modulmanifestet.** `evidenceRef` i `contracts/module-manifest.schema.json` kan bære de samme felter, så et modul kan erklære et versioneret driftsbevis frem for en tekstetikette.
6. **Release-gaten.** `REQ-EVIDENCE-001` i testmatricen kræver `evidence-mode-check`, `evidence-mode-test` og den eksterne `evidence-probe-staging`.
7. **Negativ bypass.** Testene dækker direkte endpoint-kald (utillidtværdig adresse/rå `x-spiffe-id`), frakoblet PDP (dødemandsgreb, ingen executor) og forældet/fremtidsdateret evidens.

Resultatet valideres i `make evidence-mode-check`, `make evidence-mode-test` og
`make evidence-probe` (NOT RUN uden `DKC_PROBE_*`).

## Konsekvenser

- **Positive:** Fixture-, kontrakt-, integrations- og driftsbevis er nu maskinelt adskilt, friskhed og binding håndhæves, og en redigeret PASS-streng accepteres ikke.
- **Negative:** En fuld produktionsbadge kræver en kørende installation og en sat binding; indtil da er resultatet `fixture-only`/`not-run`, hvilket er ærligt men blokerende.
- **Neutrale:** De eksisterende fixturechecks er uændrede og kører fortsat hurtigt offline.

## Fordele og ulemper ved mulighederne

| Mulighed | Fordele | Ulemper |
| --- | --- | --- |
| Kun dokumentation | Hurtigt | Ingen håndhævelse |
| Nyt prose-felt | Lille ændring | Kan ikke afvises maskinelt |
| Versioneret post + badge + prober | Efterprøveligt i dag | Kræver kørende installation for fuld badge |

## Mere information

- [`docs/spec/evidence-modes.md`](../spec/evidence-modes.md)
- [`contracts/evidence-record.schema.json`](../../contracts/evidence-record.schema.json),
  [`conformance/src/evidence-mode.mjs`](../../conformance/src/evidence-mode.mjs)
- [ADR-0007](0007-evidens-og-prosa-adskilt.md), [ADR-0018](0018-stram-policy-scope-og-evidenkontrol.md), [ADR-0028](0028-testmatrix-og-releasegates.md), [ADR-0032](0032-reproducerbare-artefakter-og-releasevej.md)
