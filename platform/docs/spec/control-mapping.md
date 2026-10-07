# Kontrolmapping: NIS2, GDPR og AI Act

**Kode:** [`compliance/`](../../compliance)
**Kontrakt:** [`contracts/control-mapping.schema.json`](../../contracts/control-mapping.schema.json)
**Tabel:** [`docs/compliance/mapping.md`](../compliance/mapping.md)
**Backlog:** 3.2

> Map dine tekniske kontroller mod krav. Rolleafklaring: udgiver vs. deployer.

## Formål

Konformanssuitten siger, om et modul lever op til platformens kontrakter. Den siger ikke, hvilke regulatoriske krav de kontrakter tjener. 3.2 lukker hullet: hver tekniske kontrol (`ac-2`, `au-2`, `au-9`, `cp-9`, `si-12`, …) kortlægges mod konkrete krav i NIS2, GDPR og AI Act, og hvert krav mærkes med, om det er platformens (udgiver), organisationens (deployer) eller begges ansvar.

Kortlægningen er en påstand om **mekanismer**, ikke om juridisk compliance. Repoet er ikke «compliant software»; det gør en organisation i stand til at dokumentere og håndhæve sine kontroller.

## Kanonisk kilde og genereret tabel

`compliance/control-mapping.json` er den eneste kilde. `docs/compliance/mapping.md` genereres fra den, så den menneskelæste tabel ikke kan drive fra den maskinlæste:

```
compliance/control-mapping.json ──render──▶ docs/compliance/mapping.md
        │
        ├── valideres mod contracts/control-mapping.schema.json
        ├── krydsrefereres: kontroller må kun pege på kendte krav
        └── læses af konformanstjekket C-012
```

`make compliance-check` fejler, hvis den genererede fil er ude af trit. Det er samme princip som change loggen og conformance-badgen: det, en revisor læser, skal kunne genskabes maskinelt.

## Udgiver og deployer

| Rolle | Bærer | Eksempel |
| --- | --- | --- |
| `issuer` | Platformen | Signerede policy-bundles, hash-kædet audit-log, OSCAL-evidens |
| `deployer` | Den ansvarlige organisation | MFA, træning, indberetning af hændelser, DPIA |
| `shared` | Begge | Adgangskontrol: platformen leverer OIDC/SCIM/SPIFFE, deployer tildeler rettigheder |

Et krav er først opfyldt, når begge sider af et `shared`-krav har gjort deres. Evidenspakken fra 3.1 viser platformens halvdel; deployerens halvdel ligger uden for repoet og skal dokumenteres af organisationen.

## Sådan håndhæves det

- **Skema:** `compliance/control-mapping.json` valideres mod kontrakten i `make compliance-check` og i evidens-emitterens tests.
- **Krydsreferencer:** `findProblems` afviser dubletter og kontroller, der peger på et krav, der ikke findes.
- **Modulbinding:** konformanstjek `C-012` fejler, hvis et modul påstår en `controlRef`, der ikke er i registry.
- **Genereret dokumentation:** `make compliance-check` fejler ved drift mellem registry og `mapping.md`.

## Acceptkriterier (3.2)

- [x] Mapping-tabel i `/docs/compliance` (`mapping.md`), genereret fra en kanonisk registry.
- [x] README siger eksplicit, at repoet ikke er «compliant software».
- [x] Udgiver-/deployer-rollen er erklæret per krav og forklaret i prosa.
- [x] Kortlægningen er maskinlæsbar, valideret og håndhævet (`C-012`, `make compliance-check`).

## Grænser

- Kortlægningen er ikke en juridisk vurdering og er ikke gennemgået af en advokat. Den er et teknisk udgangspunkt, der skal valideres af organisationens DPO og ledelse.
- `ra-5` (sårbarhedsovervågning) er kun delvist dækket; 3.4 kobler Trivy/Falco/Wazuh på og lader resultaterne indgå i evidensplanen.
