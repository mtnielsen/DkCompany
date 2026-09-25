# Beskyttede dataklasser (AI-immutable)

**Kode:** [`data-protection/`](../../data-protection), [`runtime/`](../../runtime)
**Kontrakt:** [`contracts/protected-data.schema.json`](../../contracts/protected-data.schema.json)
**Tabel:** [`docs/compliance/protected-data.md`](../compliance/protected-data.md)
**Beslutning:** [ADR-0030](../adr/0030-ai-immutable-dataklasser.md) · **Backlog:** DKC-047

> Adskil forbud mod AI-ændring fra WORM-retention og fra forbud mod AI-læsning.

## Formål

«AI-immutable» bliver ofte ét ord for tre forskellige ting. DKC-047 holder dem
adskilt, så en beslutning om opbevaring ikke forveksles med et adgangsforbud:

| Begreb | Betydning |
| --- | --- |
| **AI må ikke ændre** | Dataklasserne `ai-read-only`, `append-only` og `retention-locked`. AI kan læse (og for `append-only` tilføje), men ikke ændre, slette, omklassificere eller omskrive pointere. |
| **WORM-retention** | `retention-locked` kræver en vurderet, formålsbestemt og **endelig** frist. Det er en opbevaringsbeslutning, ikke et AI-forbud. |
| **AI må ikke læse** | `noAiAccess` er et **selvstændigt adgangsflag** der udelukker alle AI-flows, også retrieval, prompts, logs og trænings-/analyse. |

## Dataklasser

| Klasse | AI tilladt |
| --- | --- |
| `ordinary` | Alt (ingen beskyttelse) |
| `ai-read-only` | Læse, hente, prompte, analysere, logge, træne |
| `append-only` | Ovenstående + tilføje (append); ikke ændre/slette |
| `retention-locked` | Kun læse, hente og logge |

`noAiAccess: true` tilsidesætter tabellen: ingen AI-operation er tilladt.

## Beskyttelsesmetadata

Hver post i `data-protection/records/register.json` bærer:

- **ejer** og **reclassifiers** (navngivne mennesker; AI kan aldrig omklassificere),
- **versions-ID** (`versionId`) og **autoritativ pointer** (`authoritativePointer`),
- **nøgledomæne** (`keyDomain`),
- **retention/hold** (formål, endelig frist, aktivt hold, vurderingsansvarlig),
- de **otte forbud**: direkte og indirekte ændring, alias-/current-pointer,
  autoritativ pointer, policy, lifecycle, nøgler og sletning,
- den **menneskelige proces** for ny version, lovlig sletning og
  retentionvurdering,
- **storageEnforcement**: ærlig status (`unsupported`/`partial`/`full`).

## Håndhævelse

`data-protection/src/guard.mjs` er en ren, **deny-only** funktion. Den ligger
foran PDP'en og executoren i `runtime/src/runtime.mjs`:

```text
agent handling → A4 → scope → rolle → BESKYTTELSESGUARD → PDP → executor
```

- En AI-principal afvises for enhver muterende operation på en beskyttet post.
- `noAiAccess` afviser alle AI-operationer.
- `reclassify` og `pointer-update` afvises altid for AI; kun en reclassifier kan
  omklassificere, og det kræver den menneskelige proces.
- **Transitioner** (`copy`, `export`, `restore`) skal bevare klasse og
  no-AI-access-flag. En WORM-post må ikke genskabes uden sin retention, et aktivt
  hold må ikke falde bort, og fristen må ikke forlænges ubestemt.
- App-, admin- og restore-adaptere kalder samme guard (`guardAdapterCall`), så
  beskyttelsen ikke kan omgås ved at vælge en anden indgang.

## Ærlig lagerhåndhævelse

Fuld fysisk lager-/nøglehåndhævelse (WORM på objektlager, nøgleødelæggelse,
uforanderlige snapshots) er **ikke** leveret i DKC-047. Alle poster erklærer
`storageEnforcement.status: "unsupported"` og `deliveredBy: "DKC-048"`.
`make data-protection-check` fejler, hvis en post påstår `full` uden bevis, og
udskriver de ærlige huller. Beskyttelsen i DKC-047 er adgangs- og
transitionskontrol — ikke en fysisk WORM-lås.

## Ingen ubestemt WORM på persondata

En `retention-locked` post med persondatakategorier kræver en `retention` med
formål, endelig `maxDays`, vurderingsansvarlig (`assessedBy`) og dato. Den
semantiske validator afviser en WORM-lås uden frist eller formål.

## Sådan håndhæves det

```bash
make data-protection-write   # genskab docs/compliance/protected-data.md
make data-protection-check   # validér forbud, modul-dækning og ærlig håndhævelse
make data-protection-test    # guard, transitioner, register og runtimehåndhævelse
```

## Acceptkriterier (DKC-047)

- [x] AI-read-only kan ikke omgås ved at kalde en app-, admin- eller restoreadapter.
- [x] No-AI-access udelukker også retrieval, prompts, logs og trænings-/analyseflows.
- [x] AI kan ikke omklassificere data eller omskrive den autoritative pointer.
- [x] Beskyttelsen overlever kopiering, eksport og restore efter vedtaget politik.
- [x] Ingen ubestemt WORM-lås på persondata uden vurderet formål og frist.

## Grænser

- DKC-047 er adgangs-/transitionskontrol. Den fysiske WORM-lås og
  nøglehåndhævelsen leveres af **DKC-048** og er påkrævet, før beskyttelsen kan
  kaldes uigennemtrængelig.
- Politikken er en delt, versioneret regel (ikke en del af den signerede
  platform-bundle), så den kan revideres uden at re-signere hele bundlen.
- Ingen kørende ekstern nøgletjeneste er bevist i dette miljø.
