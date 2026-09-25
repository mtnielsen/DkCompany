# Runbook: AI i skyggetilstand og begrænset autonomi

Denne runbook beskriver, hvordan en serviceejer måler og gradvist udvider
AI-driftens autonomi. Den erstatter ikke den menneskelige beslutning; den gør
den versionsstyret og evidensbaseret.

## 1. Start i skyggetilstand

1. Kør replayet mod det anonymiserede datasæt:

   ```sh
   make shadow-run
   make shadow-check
   ```

2. Kontrollér i `shadow/report/shadow-report.json` (og
   `docs/ai-operations/shadow-report.md`) at `shadow.mutationCount = 0`, at
   `shadow.verdict = "pass"`, og at gaten er `pass`.
3. Gennemgå `limitedAutonomy.decisions` for afviste og eskalerede forslag. Et
   irreversibelt forslag (`migrate`, `restore`, …) skal altid eskalere til et
   menneske.

## 2. Bind bevillingen til et model-/promptfingeraftryk

`shadow/autonomy-policy.json` angiver:

- `evaluation.modelRef` og `evaluation.promptDigest`,
- `evaluation.fingerprint = digest(modelRef, promptDigest)`,
- `evaluation.minEvaluationRuns` (mindst 2; i den vedtagne bevilling 3),
- `evaluation.thresholds`.

Ændres modellen eller prompten, ændres fingeraftrykket. Kør mindst
`minEvaluationRuns` beståede evalueringer på det nye fingeraftryk, før
`evaluation.runs` og `evaluation.fingerprint` opdateres. Indtil da afviser
`assertAllowed` begrænset autonomi.

## 3. Udvid autonomien (ejerbeslutning)

En udvidelse er en ny version af bevillingen og kræver:

1. et **navngivet menneske** som ejer,
2. mindst `minEvaluationRuns` **beståede** evalueringer på det nye fingeraftryk,
3. en **change-reference** (fx et ADR eller en change-request),
4. at scopet forbliver staging-only, reversibilitetskrævende og uden
   irreversible verber.

`createAutonomyRegister(grant).expand({ toLevel, owner, evaluationRuns, changeRef })`
returnerer den nye version med en udvidet `history`. Funktionen nægter at
udvide uden evidens eller uden et navngivet menneske.

## 4. Stop

- **Nødstop:** aktivér det globale, tenant- eller agentnødstop gennem den
  normale nødstopskanal (DKC-010). Kørslen kontrollerer det før hver muterende
  handling og stopper fail-closed.
- **Governance-nedbrud:** hvis PDP/governance er utilgængelig, stopper kørslen
  uden at udføre noget.

## 5. Rul tilbage / nedgradér

Sæt `metadata.version` op og `level` ned til `shadow` eller `propose`, opdater
`history`, og kør `make shadow-check`. En nedgradering kræver ikke ny
evaluering, men skal stadig være en versionsstyret ejerbeslutning.

## 6. Bevis og revision

- `shadow/report/shadow-report.json` og `docs/ai-operations/shadow-report.md`
  er de genererede artefakter.
- `make shadow-check` genkører replayet deterministisk og sammenligner.
- En målt kørsel mod en levende model og staging er `make shadow-live` og er
  NOT RUN i dette miljø. Den udføres af et menneske i en isoleret staging og
  gemmes som ekstern evidens.
