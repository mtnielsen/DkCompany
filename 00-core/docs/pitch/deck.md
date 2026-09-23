# Platformskontrakter — pitch

> Ét deck med én fungerende adapter og kørende konformanstest slår tolv tomme repos.

Hver slide har én pointe og én **Bevis**-linje. `make pitch-check` efterprøver at hvert bevis peger på en kommando og en fil, der faktisk findes. Et løfte uden bevis ryger ud.

---

## Slide 1 — Problemet

**Pointe:** Alle har en politik. Næsten ingen kan vise, at den virker. Revisoren får prosa; driften får en PDF.

**Bevis:** `docs/adr/0001-fire-planer.md`

---

## Slide 2 — Idéen: kontrakt før implementering

**Pointe:** En spec uden testsuite er en PDF, ingen følger. Vi skriver kontrakten og den kørende test i samme commit.

**Bevis:** `contracts/module-manifest.schema.json` · `make conform MODULE=mattermost-adapter`

---

## Slide 3 — De fire planer

**Pointe:** Identitet, telemetri, ops og privacy. Fire kontrakter, der kan testes — ikke ti planer, der aldrig bliver implementeret.

**Bevis:** `docs/spec/identity-plan.md` · `docs/spec/ops-contract.md`

---

## Slide 4 — Beviset: konformanssuiten

**Pointe:** `make conform` siger pass eller fail pr. krav. Den bevidst brudte fixture fejler, og det er en test i sig selv.

**Bevis:** `make conform MODULE=dummy-ok` · `make conform-negative`

---

## Slide 5 — Ærlig partial conformance

**Pointe:** En adapter, der ikke kan slette fra backups, skal kunne sige det uden at fejle. `partial` med begrundelse slår en løgn.

**Bevis:** `modules/mattermost-adapter/module-manifest.json` · `docs/adr/0003-partial-conformance.md`

---

## Slide 6 — Policy og fail-closed

**Pointe:** Moduler og agenter spørger en central PDP. Kan den ikke nås, sker der ingenting. Beslutningen bærer den bundle, den blev truffet med.

**Bevis:** `make policy-verify` · `policy/pdp/src/pdp.mjs`

---

## Slide 7 — Git som eneste ændringskanal

**Pointe:** Drift uden om git opdages og føres tilbage. Historikken er den komplette change log, DCO-signeret.

**Bevis:** `make gitops-drift` · `make changelog-check` · `gitops/src/verify.mjs`

---

## Slide 8 — Agenter inden for en grænse

**Pointe:** En agent må kun bruge deklarerede verber, stopper ved utilgængelig governance og eskalerer ved budget- og loop-brud. A4 kan ikke deklareres.

**Bevis:** `make agent-conformance-test` · `runtime/src/runtime.mjs`

---

## Slide 9 — Evidens frem for prosa

**Pointe:** Godkenderen møder maskinevidens og agentprosa visuelt adskilt. Reviewer-agenten kan kun flagge eller afvise — aldrig godkende.

**Bevis:** `make reviewer-test` · `approvals/src/approval-service.mjs` · `docs/adr/0007-evidens-og-prosa-adskilt.md`

---

## Slide 10 — Evidens til revisoren

**Pointe:** Konformanskørsler, policy, audit, git og GitOps bliver til én OSCAL-pakke. Sikkerhedsfund er ikke en silo; de bæres af samme pakke.

**Bevis:** `evidence/src/oscal.mjs` · `make oscal-evidence`

---

## Slide 11 — Fra teknik til compliance

**Pointe:** Hver teknisk kontrol kortlægges mod NIS2, GDPR og AI Act, med udgiver/deployer-rollen eksplicit. Repoet er ikke «compliant software» — det gør ansvaret synligt.

**Bevis:** `compliance/control-mapping.json` · `make compliance-check`

---

## Slide 12 — Drift, sikkerhed og ejerskab

**Pointe:** SLO-dashboards genereres fra manifesterne, Trivy/Falco/Wazuh emitteres gennem evidensplanen, og godkendere trænes på forslag, der skal afvises.

**Bevis:** `make observability-check` · `make security-check` · `make curriculum-check`

---

## Slide 13 — Kom i gang på fem minutter

**Pointe:** Klon, kør `make install && make ci`, og se en adapter bestå, en bevidst brudt fejle, og en OSCAL-pakke blive skrevet.

**Bevis:** `Makefile` · `docs/pitch/README.md`

---

## Slide 14 — Call to action

**Pointe:** Byg ikke endnu en platform fra bunden. Tag kontrakten, adapteren og suiten — og gør din første stædige upstream målbar.

**Bevis:** `docs/spec/adapter.md` · `make iam-adapter-test`
