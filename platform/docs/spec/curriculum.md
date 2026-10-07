# Ejer-curriculum

**Kode:** [`curriculum/`](../../curriculum)
**Kontrakt:** [`contracts/curriculum.schema.json`](../../contracts/curriculum.schema.json)
**Backlog:** 4.1 (afhænger af 2.4 og 3.2)

> Bygget på rigtige approval-payloads, inkl. forslag der *skal* afvises.

## Formål

En godkender, der kun har læst en politik, godkender fortællingen. Curriculumet træner godkenderen på **de faktiske payloads** platformen producerer — og på forslag, der ser pæne ud, men skal afvises. Det er forskellen mellem at kende reglerne og at kunne bruge dem under pres.

## Bygget på rigtige payloads

Hvert scenarie tager udgangspunkt i en committet approval-request og muterer den via sti-overrides:

```json
{
  "id": "untested-rollback",
  "base": "default",
  "overrides": { "rollback.tested": false },
  "expectedVerdict": "reject",
  "mustReject": true,
  "teachingPoint": "Utestet rollback er ikke rollback.",
  "rejectionCriteria": [
    { "path": "rollback.tested", "operator": "eq", "value": false, "reason": "..." }
  ]
}
```

`base` peger på en rigtig payload i `basePayloads`. `overrides` muterer dybe stier. `rejectionCriteria` er deterministiske og efterprøves i CI: et reject-scenarie er kun gyldigt, hvis kriterierne faktisk holder i payloaden. Et approve-scenarie må ikke opfylde et afvisningskriterium og må ikke have påstande, der ikke matcher evidensen.

## Moduler

| Modul | Emne | Scenarier |
| --- | --- | --- |
| `legal-responsibility` | Juridisk ansvar | Et navngivet menneske bærer ansvaret |
| `evidence-over-prose` | Læs evidens frem for prosa | Påstand mod diff, manglende testevidens |
| `when-to-reject` | Hvornår afvises | Utestet rollback, utroværdig trigger, fejlende tests |
| `kill-switch` | Kill switch | Ingen måde at stoppe på |
| `first-24-hours` | Første 24 timer ved hændelse | Hasteændring i prod uden evidens |

Curriculumet indeholder 8 scenarier, hvoraf 7 skal afvises.

## Versionering og håndhævelse

- Curriculumet versioneres med platformen (`metadata.version`).
- Gennemførelse logges som et CloudEvent af typen `dk.platform.curriculum.module.completed` med principal og modul-id.
- `trainingRegistryFromEvents` bygger det `trainingRegistry`, som approval-servicen (2.4) bruger. En godkender uden de påkrævede moduler afvises med HTTP 428.
- Kontrolmappingen (3.2) fører `at-2` mod NIS2 art. 21(2)g og AI Act art. 4.

```
curriculum.json ──validate──▶ scenarier (approve/reject)
       │
       └──complete──▶ CloudEvent ──▶ trainingRegistry ──▶ approval-service (2.4)
```

## Sådan køres det

```bash
make curriculum-check     # validér curriculum + afvisningskriterier + CloudEvents
make curriculum-render    # vis moduler og scenarier
make curriculum-test      # 5 tests, inkl. håndhævelse i approval-servicen
node curriculum/src/cli.mjs render-completion   # eksempel på et gennemførelses-event
```

## Acceptkriterier (4.1)

- [x] Bygget på rigtige approval-payloads via base + overrides.
- [x] Forslag, der skal afvises, er eksplicitte og deterministisk tjekkede (`mustReject` + `rejectionCriteria`).
- [x] Versioneret med platformen.
- [x] Gennemførelse logges som CloudEvent og håndhæves af approval-servicen (2.4).
- [x] Alle fem emner er dækket: juridisk ansvar, evidens frem for prosa, hvornår afvises, kill switch, første 24 timer.

## Grænser

- Curriculumet er teknisk træning, ikke juridisk rådgivning. Den juridiske del skal valideres af organisationens DPO og ledelse.
- `trainingRegistryFromEvents` er en in-memory reference; i produktion læses gennemførelser fra audit-loggen eller en identitetsudbyder.
