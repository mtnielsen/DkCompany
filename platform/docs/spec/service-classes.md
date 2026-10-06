# Serviceklasser og recoverymål (DKC-037)

**Kode:** [`continuity/`](../../continuity)
**Kontrakt:** [`service-class.schema.json`](../../contracts/service-class.schema.json)
**BIA:** [`docs/continuity/bia.md`](../continuity/bia.md)
**ADR:** [ADR-0026](../adr/0026-fejlomraader-n-plus-1-og-recovery.md)

## Formål

Skalerbarhed og databevarelse skal være **målbare krav pr. tjeneste**, ikke
prosa. Hver tjeneste har en serviceklasse der beskriver holdbarheds-/fejlmodellen,
adfærden ved netværkspartition, tilgængelighed, tre adskilte RPO-mål (bekræftede
writes, regionsnedbrud, korruption), RTO, replikering, backup og hvilke
healinghandlinger der er tilladte. Serviceklassen er samtidig
kompatibilitetskontrakten mellem tjenesten og en deployment-profil.

En serviceklasse kan være `proposed` eller `accepted`. Først når et navngivet
menneske har vedtaget målene, er der en forpligtelse. En konfigurationspost
certificerer aldrig et målt serviceniveau — det gør kun en frisk måling.

## Kontrakten

```json
{
  "kind": "ServiceClass",
  "moduleRef": "audit-service",
  "criticality": "critical",
  "biaRef": "docs/continuity/bia.md#audit-service",
  "failureModel": {
    "networkPartition": { "behavior": "fail-closed", "splitBrain": "forbidden", "quorumRequired": true, "description": "..." },
    "corruptionDetection": { "method": "...", "detectionWindowMinutes": 60 }
  },
  "availability": { "targetPercent": 99.95, "measurementWindowDays": 30, "acceptedDowntime": false },
  "durability": {
    "confirmedWrites": { "rpoMinutes": 0, "strategy": "...", "basis": "..." },
    "regionFailure": { "rpoMinutes": 15, "strategy": "...", "basis": "..." },
    "corruption": { "rpoMinutes": 1440, "strategy": "...", "basis": "..." }
  },
  "recovery": { "rtoMinutes": 60, "restoreOrder": ["database", "storage", "audit-service", "queue"], "healing": { "allowedActions": ["restart", "failover"], "forbiddenActions": ["disable-audit"], "requiresHumanApproval": ["restore-from-backup"] } },
  "replication": { "replicas": 3, "statefulMode": "stateful", "storageClass": "encrypted-ssd-rwo", "consistency": "strong", "writeMode": "leader-elected", "activeWriters": 1, "upstreamSupportsMultiWriter": false },
  "backup": { "required": true, "mode": "external", "offsite": true, "encrypted": true, "restoreTested": true, "retentionDays": 365 },
  "deploymentProfileCompatibility": { "profiles": ["multiple-servers", "dedicated-customer"], "haEligible": true, "failureDomains": 3, "nPlusOne": true, "recoveryLocation": "eu-central-2" },
  "serviceCommitment": { "state": "accepted", "acceptedBy": { "...": "..." }, "acceptedAt": "...", "measured": { "availabilityPercent": 99.97, "capturedAt": "...", "evidenceRef": "...", "source": "probe" } }
}
```

## Regler der håndhæves

- **Tre adskilte holdbarhedsmål.** `confirmedWrites`, `regionFailure` og
  `corruption` er påkrævede og må ikke være identiske. Et regionsnedbrud kan
  ikke have et strammere RPO end den normale write-vej.
- **Netværkspartition.** Adfærden skal være eksplicit. En ikke-`fail-closed`
  adfærd der forbyder split-brain kræver quorum.
- **Skrivere.** `single-writer` er standard. Flere aktive skrivere kræver
  `upstreamSupportsMultiWriter: true` og `writeMode: "multi-writer"`. Man må
  ikke antage at alle apps kan multi-writer.
- **HA.** `haEligible: true` kræver ≥3 replikaer, ≥3 failure domains, N+1,
  særskilt `recoveryLocation` og ekstern/offsite backup. HA kan ikke kombineres
  med `single-server`.
- **Single-server.** Understøttet non-HA-produktionsprofil, men kræver
  `acceptedDowntime: true` og ekstern/offsite backup. Den kan ikke få HA-badge.
- **Menneskelig vedtagelse.** `accepted` kræver et navngivet menneske,
  et accepttidspunkt og målt evidens. `proposed` må ikke fremstilles som en
  vedtaget forpligtelse.

## Helbreds-/recovery-rapportering

`continuity/src/recovery.mjs` forbinder de validerede mål med faktiske målinger:

| Felt | Betydning |
| --- | --- |
| `commitment` | `proposed` / `accepted` / `retired` |
| `measured.status` | `measured` (frisk probe), `declared-only` (kun erklæring) eller `not-measured` |
| `haBadge` | Kun sand ved vedtaget forpligtelse, HA-egnethed og en frisk failover-måling |
| `productionReady` | Vedtaget forpligtelse, testet gendannelse og enten HA-badge eller accepteret nedetid |
| `gaps` | Hvad der udestår, i klartekst |

```bash
node continuity/src/report.mjs                              # markdown, ingen prober
node continuity/src/report.mjs --probes probes.json --json  # med friske prober
```

En probe er `{ moduleRef, kind: "availability"|"failover"|"restore", value, capturedAt, evidenceRef }`. Kun prober inden for freshnesvinduet (default 90 dage) tæller.

## Kompatibilitet med deployment-profiler

`continuity/src/profile-check.mjs` krydser serviceklasserne med
`contracts/examples/deployment-profile.*.example.json`:

- en HA-profil kræver mindst én HA-egnet serviceklasse, og ingen klasse der
  peger på profilen må være ikke-HA,
- en non-HA-profil (`single-server`) må ikke bruge en HA-egnet klasse og kræver
  accepteret nedetid.

## Kør

```bash
make validate           # skema + eksempel + semantik
make continuity-check   # serviceklasser, moduldækning og profiler
make continuity-test    # 21+ tests inkl. umulige/konfliktende krav
make continuity-report  # recovery-rapport (markdown)
make architecture-test  # DKC-002-kontrakterne (uændret)
```

Et modul peger på sin serviceklasse med `serviceClassRef` i
`module-manifest.json`. Et pilotmodul uden serviceklasse afvises.
