# Referenceadapter B: Mattermost

**Kode:** [`modules/mattermost-adapter`](../../modules/mattermost-adapter)
**Manifest:** [`module-manifest.json`](../../modules/mattermost-adapter/module-manifest.json)
**Backlog:** 1.4

## Formål

Bevis at kontrakten holder mod virkeligheden — en stædig upstream, vi ikke ejer og ikke ændrer. Adapteren wrapper **Mattermost uændret** og oversætter platformens verber til Mattermost REST API v4.

Dette er punktet, der afslører om kontrakten er realistisk. Det forventede resultat er `partial` på `subject.erase` — og at suiten accepterer det som ærligt, ikke som fejl.

## Hvad adapteren kan

| Verbum | Niveau | Hvorfor |
| --- | --- | --- |
| `health` | full | Mattermosts `/system/ping` spejles |
| `subject.locate` | full | Brugers opslag findes via e-mail → bruger → posts |
| `subject.export` | full | Opslag eksporteres pr. subjekt |
| `subject.erase` | **partial** | API'et sletter opslag, men ikke backups, søgeindeks og revisionsspor |
| `drain` | partial | Læs-tilstand via config, men websockets kan ikke drænes |
| `upgrade.dry-run` | partial | Versioner kan rapporteres, men ingen egentlig dry-run |
| `slo` | partial | Adapterens egen svartid, ikke Mattermosts SLO |
| `backup`, `restore`, `verify-restore`, `upgrade`, `migrate`, `rollback` | unsupported | Ligger på database-/fillag uden for API'et |
| `subject.legal_hold` | unsupported | Mattermost har ingen legal-hold API |
| `retention.policy` | partial | Globale indstillinger, ikke pr. subjekt |

## Den vigtige `partial`

`subject.erase` svarer:

```json
{
  "recordsAffected": 2,
  "partial": true,
  "note": "Opslag slettet via Mattermost API. Kopier i backups, søgeindeks og revisionsspor er ikke fjernet og skal håndteres af upstream-drift."
}
```

Erklæringen er ikke en undskyldning; den er sand og maskinlæsbar. DSAR-orkestratoren kan rapportere `partial` videre til DPO'en, i stedet for at skjule at slettningen er ufuldstændig. Se [ADR-0003](../adr/0003-partial-conformance.md).

## Upstream røres ikke

Adapteren kalder kun Mattermosts offentlige API. Testene kører mod en mock (`mock-mattermost.mjs`) med de samme endpoints, så adfærden er bevist uden en rigtig installation. I produktion er `MATTERMOST_URL` peget på den uændrede upstream.

## Policy og fail-closed

Adapteren spørger central PDP før hver gated handling. `deny` → 403. Utilgængelig PDP → 503, og **intet slettes**: testen `utilgængelig PDP betyder ingen sletning` bekræfter, at opslagene stadig er der.

## Bevis fremkaldt

```bash
make adapter-evidence
# subject.erase -> HTTP 200, partial=true, slettet=2
make conform MODULE=mattermost-adapter
# RESULTAT: PASS  (10 pass, 2 skip, 0 fail)
#   3 full, 12 partial/unsupported — alle begrundede
```

## Acceptkriterier (1.4)

- [x] Adapteren kører (7 tests mod mock Mattermost).
- [x] Manifestet deklarerer ærligt, hvad der ikke kan lade sig gøre.
- [x] Suiten accepterer `partial`, ikke fail.
- [x] Deployet via GitOps (`gitops/manifests/dev/mattermost-adapter-*`).
