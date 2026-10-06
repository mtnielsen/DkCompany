# Migrationsvej: single-server til HA

**Profiler:** `small-vps` → `ha-cluster` (og videre til `enterprise-dedicated`)
**Forventet nedetid:** 60 minutter for `small-vps` → `ha-cluster`; 120 minutter for
`small-vps` → `enterprise-dedicated`
**Kontrakter:** [`installation-profile.schema.json`](../../contracts/installation-profile.schema.json),
[`deployment-profile.schema.json`](../../contracts/deployment-profile.schema.json)
**ADR:** [ADR-0027](../adr/0027-installationsprofiler-og-resolver.md)

## Formål

Et skift fra en single-server-installation til en HA-installation må ikke være
en mundtlig tradition. Denne vej beskriver hvad der flyttes, i hvilken rækkefølge,
og hvad den forventede nedetid dækker. Den supplerer
[`docs/spec/distribution-profiles.md`](../spec/distribution-profiles.md).

## Før du begynder

- Den eksisterende installation er en `small-vps` (single-server, non-HA) med
  eksplicit accepteret nedetid og ekstern, offsite backup.
- `make distribution-check` er grøn, og `make continuity-check` er grøn.
- Serviceklasserne er `accepted` af et navngivet menneske, eller det er
  accepteret at de stadig er `proposed` og dermed ikke produktionsklare.
- Der findes mindst tre uafhængige fejldomæner og en særskilt recovery-lokation
  jf. [ADR-0026](../adr/0026-fejlomraader-n-plus-1-og-recovery.md).
- Nødproceduren er testet, og den out-of-band recoveryvej er uafhængig af den
  automatiske vej.

## Trin

1. **Tilføj fejldomæner.** Rejs mindst to ekstra fejldomæner og bring dem i
   samme kontrolplan som den eksisterende server. Verificér identitet og
   tenantgrænser i det nye miljø.
2. **Replikér primærdatabasen.** Flyt `primary-database` til en replikeret
   konfiguration med mindst tre replikaer og N+1-kapacitet. Den eksisterende
   database forbliver primær, indtil failover er målt.
3. **Aktivér offsite backup.** Peg `backup-destination` på en særskilt
   recovery-lokation uden for det primære fejldomæne. Kør `verify-restore`.
4. **Planlæg vinduet.** Den forventede nedetid er **60 minutter** for
   `ha-cluster` og **120 minutter** for `enterprise-dedicated`. Vinduet dækker
   drain, failover, validering og eventuel tilbageførsel.
5. **Drain og failover.** Sæt den gamle server i drain, gennemfør failover, og
   bekræft at alle skrivninger er committet til det nye quorum.
6. **Mål og vedtag.** Kør en planlagt failover-måling. Opdatér serviceklassen
   fra non-HA til HA med målt evidens, og lad et navngivet menneske vedtage
   målene (`serviceCommitment.state: accepted` med `acceptedBy`, `acceptedAt`
   og `measured.evidenceRef`).
7. **Ryd op.** Fjern den gamle single-server-konfiguration, når HA er målt og
   vedtaget. Rollback er at pege tilbage på den gamle primære database indtil
   offsite-backuppen er verificeret.

## Rollback

Rollback til single-server er mulig, indtil den gamle primære database
nedlægges. Den består i at pege kontrolplanen tilbage på den gamle database,
genoptage skrivninger der og bekræfte `verify-restore`. Efter nedlæggelse kræver
rollback en gendannelse fra offsite-backuppen og har samme nedetidsvindue.

## Hvad nedetiden ikke dækker

- Offsite-backuppens replikeringslag (kører kontinuerligt).
- DNS- og internetforbindelser hos kunden.
- Menneskelig beslutningstid ud over det planlagte vindue.

## Verifikation

- `make distribution-test` beviser at `ha-cluster` har en `migration` med
  `pathRef` til dette dokument og `expectedDowntimeMinutes > 0`.
- `make continuity-check` beviser at serviceklasserne er kompatible med
  HA-profilen (≥3 fejldomæner, N+1, særskilt recovery-lokation).
- `make continuity-report` viser at HA-badgen først sættes efter en frisk
  failover-måling.
