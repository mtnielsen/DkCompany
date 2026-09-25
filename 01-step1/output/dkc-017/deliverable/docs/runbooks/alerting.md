# Runbook — Alarmering og hændelseshåndtering

**Kode:** [`observability/sensors.json`](../../observability/sensors.json) · [`observability/alert-rules.json`](../../observability/alert-rules.json)
**Spec:** [`docs/spec/monitoring.md`](../spec/monitoring.md)
**Ejere:** Platform Owner og Security Owner (se reglerne for den præcise ejer)

> En alarm har altid en ejer, en eskalation og en runbook. En grøn
> sikkerhedsstatus kræver en **frisk** måling — forældede eller manglende
> sensordata er ikke grønne.

## Når en alarm udløses

1. **Kvittér** alarmen i modtagerkanalen. Kvitteringen registreres i
   hændelsesforløbet (`incidents/<id>.json`) med dit verificerede subject.
2. **Slå sensoren op** i `observability/sensors.json` og læs dens `source`,
   `owner`, `maxAgeSeconds` og `runbook`.
3. **Vurdér friskheden.** En `stale`/`missing`-status betyder, at der ikke
   findes et frisk bevis — ikke at alt er i orden.
4. **Følg sensorens egen runbook** (fx `backup-restore.md`,
   `vulnerability-response.md` eller `key-management.md`).
5. Hvis alarmen ikke er kvitteret inden for eskalationsvinduet, sendes den
   videre til næste trin i `escalation`. Eskaleringen sker i forløbet, ikke
   som en mundtlig aftale.

## De vigtigste alarmer

| Regel | Sensor | Ejerskab | Runbook |
| --- | --- | --- | --- |
| `service-unavailable` | `service-availability` | Platform Owner | denne side |
| `backup-failed` | `backup-drill` | Platform Owner | [`backup-restore.md`](backup-restore.md) |
| `security-data-stale` | `trivy-fs` | Security Owner | [`vulnerability-response.md`](vulnerability-response.md) |
| `audit-log-failure` | `audit-journal` | Security Owner | denne side |
| `credential-revocation-failed` | `credential-revocation` | Security Owner | [`key-management.md`](key-management.md) |

## Logsvigt (fail-closed)

Et logsvigt er ikke en advarsel. Når audit-journalen er utilgængelig, stopper
privilegerede handlinger (DKC-009). Alarmen `audit-log-failure` betyder:

1. Stop ikke journalen for at få grønt — det er et kontrolbrud.
2. Find årsagen (disk, checkpoint, databaseidentitet).
3. Genoptag først når journalen er skrivbar og checkpointet er intakt.
4. Dokumentér forløbet i hændelsen.

## Fejlet backup eller gendannelse

`backup-failed` udløses når gendannelsesøvelsens gate er `blocked`. Følg
[`backup-restore.md`](backup-restore.md): stands ikke ved en erklæring — øvelsen
skal indeholde målte RPO/RTO og beståede funktionelle checks. Et fejlet eksternt
mål følger [`backup-targets.md`](backup-targets.md).

## Nøglerevokation og nødstop

`credential-revocation-failed` betyder, at en øvelse i at trække en rettighed
tilbage eller aktivere nødstoppet ikke gav den forventede, holdbare effekt. Følg
[`key-management.md`](key-management.md), og bekræft at afvisningen overlever
genstart.

## Persondata i forløbet

Hændelsesforløbet er beregnet til at kunne deles bredt. Det indeholder derfor
kun minimerede felter: en digest af de fjernede persondata, ikke de rå værdier.
Rå logs og personhenførbare detaljer bliver i den adgangsstyrede kilde og
refereres med en ressource-ID.
