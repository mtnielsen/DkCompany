# Dokumentationskorrektioner — ikke-understøttede modenhedspåstande

Denne fil oplister de påstande i den relevante dokumentation, som baselinekørslen
viste ikke er dækket af et tilsvarende bevis. Retningen er: **bevar de historiske
bølger, men suppler dem med driftens faktiske status.** Derfor fjernes ingen
backlog-historik, og der omdefineres ingen scope.

Kilde til sandheden er den genererede
[`docs/status/implementation-matrix.md`](deliverable/docs/status/implementation-matrix.md)
(kørt mod commit `83ad91a`, 37 pass, 1 fail, 9 NOT RUN pr. 2026-09-23).
Overlayen i [`deliverable/`](deliverable/) indeholder de rettede filer, der kan
lægges oven på `00-core/`.

## 1. `README.md` — "Bølgerne 0–4 er implementeret"

| | |
| --- | --- |
| **Oprindelig påstand** | Overskriften "Bølgerne 0–4 er implementeret" med ✅ pr. punkt. |
| **Problem** | ✅ læses som "efterprøvet og klar", men flere punkter er kun dækket af mocks, fixtures eller er slet ikke kørt (rigtige adaptere, scanner, IdP, CI). |
| **Korrektion** | Overskriften er nu eksplicit historisk ("har kode i repoet"), og der linkes til implementation-matrixen for den faktiske, efterprøvede modenhed. |

## 2. `README.md` — punkt 0.1 "CI" som bevis

| | |
| --- | --- |
| **Oprindelig påstand** | `docs/adr`, `make validate`/`make lint`, **CI**. |
| **Problem** | `.github/workflows/ci.yml` blev fjernet i commit `76e4782`, og Actions er slået fra. Der kører ingen CI i dag. |
| **Korrektion** | CI erstattet med "(CI-workflowet er fjernet; kør lokalt)". |

## 3. `README.md` — afsnittet om at bølge 1–4 er "komplette"

| | |
| --- | --- |
| **Oprindelige påstande** | "Bølge 1 og bølge 2 er komplette …", "Bølge 3 er komplet … Trivy/Falco/Wazuh-fund indgår i evidensplanen", "… pitch-deckets beviser efterprøves i CI". |
| **Problemer** | (a) Mattermost/Keycloak er kun efterprøvet mod mock; (b) AI-gatewayen kun mod echo-provider; (c) sikkerhedsfund kommer fra committede samples, ikke en kørende scanner; (d) CI findes ikke, så "efterprøves i CI" er forkert. |
| **Korrektion** | Afsnittet er omskrevet til at skelne "fungerende førstepartskode" fra "efterprøvet mod rigtig ekstern installation", med et eksplicit forbehold og link til matrixen. |

## 4. `docs/spec/security-plan.md` — Trivy i CI

| | |
| --- | --- |
| **Oprindelige påstande** | Scanner-tabellen siger "Trivy — CI (`.github/workflows/ci.yml`)", acceptkriteriet siger "valideres i CI", og grænserne siger "CI kører Trivy rigtigt". |
| **Problem** | Workflowet findes ikke; Trivy er ikke installeret i baseline-miljøet. `make security-check` validerer kun committede samples. |
| **Korrektion** | Tabellen, acceptkriterierne og grænserne beskriver nu, at scanningen ikke kører automatisk, at `security-check` er en fixture-check, og at `integration-trivy`/`-falco`/`-wazuh` er **NOT RUN**. |

## 5. `docs/spec/reference-module.md` — "Deployet via GitOps"

| | |
| --- | --- |
| **Oprindelig påstand** | "Konformans `full` på alle verber" og "Deployet via GitOps". |
| **Problem** | Referencetjenesten kører in-process/file-backed i testen; intet deployet runtime er efterprøvet. GitOps-manifesterne findes i git, men er ikke rullet ud mod en klynge. |
| **Korrektion** | Der er tilføjet et forbehold om in-process-kørslen og ikke-idempotente fixtures, og "Deployet" er ændret til "manifester findes i git — ikke deployet i dette repo". |

## 6. Øvrige forhold, der ikke er omskrevet i prosa

- **Historiske bølger i `BACKLOG.md` er bevidst urørte.** De beskriver hensigt og
  rækkefølge, og matrixen supplerer dem i stedet for at erstatte dem.
- **`docs/spec/adapter.md` og `docs/spec/iam-adapter.md`** erklærer allerede
  ærligt mock-brug og `partial`-conformance; de er ikke rettet.
- **Kontrakt-/konformanspåstande** (fx `full` i modul-manifester) er allerede
  håndhævet af conformance-suiten (`C-003`/`C-004`), som kræver fixture eller
  probe for `full`. De er ikke dokumentationspåstande og er ikke ændret.

## 7. Fund, der ikke er en dokumentationsfejl, men en baseline-fejl

Baselinekørslen fejler på `make changelog-check`: **4 commits mangler DCO
sign-off** (`83ad91a`, `76e4782`, `5f9fa73`, `87768da`), deriblandt base-committet.
Det betyder, at det dokumenterede `make ci` **ikke** er grønt i en ren checkout.
Fejlen er ikke deaktiveret eller skjult; den fremgår af matrixens fejlafsnit og af
evidensloggen `evidence/baseline/logs/changelog-check.log`.
