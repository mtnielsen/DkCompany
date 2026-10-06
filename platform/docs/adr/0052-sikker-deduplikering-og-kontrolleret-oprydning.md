# ADR-0052 — Sikker deduplikering og kontrolleret oprydning

- **Status:** accepteret
- **Beslutningstagere:** Platform Owner, Security Owner, Data Protection Officer
- **Dato:** 2026-09-24
- **Beslutningsdrev:** DKC-043. ADR-0039/0040 gav en krypteret backup med eksterne mål, ADR-0047 gav et holdbart, versionsstyret objektlager, og ADR-0051 gav uafhængig backup, PITR og katastrofegendannelse. Det mangler at reducere unødige kopier — uden at skabe nye datatabs- eller fortrolighedsproblemer.

## Kontekst og problemstilling

Flere kopier er nødvendige for holdbarhed og recovery, men de koster kapacitet:

- en backup gemmer hele database-, objekt- og konfigurationskomponenter, selv
  når store dele er identiske med den forrige backup,
- primære objekter versioneres, men gentaget indhold gemmes igen og igen,
- jobhændelser kan leveres flere gange efter en genstart, og
- forretningsposter kan ligne hinanden uden at være den samme post.

Naiv dedup er farlig: deler man et chunk-indeks på tværs af kunder, lækker man
lighed mellem deres data. Fjerner man et chunk for tidligt, ødelægger man en
anden eller en beskyttet backup. Efterlader man et halvt indeks efter et crash,
kan en efterfølgende prune slette data der stadig bruges. Fletter man
forretningsdubletter automatisk, ændrer man forretningsbetydningen.

## Beslutningskriterier

- Dedup må kun ske inden for tenant, krypteringsdomæne og retentionklasse.
- Der må aldrig deduplikeres på tværs af kunder som standard.
- Backupblokke skal bygge på den gennemprøvede backupløsning; dedup af
  primærdata er valgfrit og kræver sin egen validering.
- Jobhændelser må kun deduplikeres på en eksplicit idempotency-nøgle.
- Forretningsposter må aldrig flettes automatisk.
- Referencekæden skal være konsistent, og en chunk må først fjernes når ingen
  snapshot refererer til den.
- Garbage collection skal være retention-aware og kræve en single-writer lease.
- Et crash midt i et indeks eller en prune skal efterlade en genoprettelig
  tilstand.
- En korrupt chunk skal opdages, og de berørte snapshots skal vises.
- En besparelse må kun aktiveres når både integritets- og restoretesten består.

## Overvejede muligheder

- **A: Fast-blok dedup (faste offsets).** Enkelt, men grænserne skubber ved
  selv små indsættelser, så næsten ingen chunks genbruges.
- **B: Dedup i et centralt, tværkundet chunk-lager.** Mest besparelse, men
  bryder tenantgrænsen og gør ligheds- og tidsangreb mulige.
- **C: Indholdsdefineret chunking pr. dedup-domæne med domæneafgrænsede nøgler,
  referencekæde, retention-aware GC og en besparelsesgate.** Flere komponenter,
  men hvert acceptkriterium bliver efterprøveligt, og tenantgrænsen bevares.

## Beslutning

Vi vælger **C**. `dedup/dedup-policy.json` er den kanoniske politik, og
`dedup/src/` implementerer:

1. **Indholdsdefineret chunking** (`chunker.mjs`): gear-CDC med sha256 pr.
   chunk, så en indsættelse kun skubber grænser i nærheden af ændringen.
2. **Domæneafgrænset lagring** (`store.mjs`, `keys.mjs`): hvert domæne har sin
   egen chunk-namespace og sin egen HKDF-afledte AES-256-GCM-nøgle. Chunk-adressen
   er `sha256(domainId + ":" + chunkSha256)`, så identisk klartekst i to domæner
   får forskellige adresser og forskellige chiffertekster.
3. **Referencekæde og retention-aware GC** (`store.mjs`): hvert snapshot er en
   ordnet liste af chunk-id'er plus en digest; refs tælles op og ned, og prune
   er mark-and-sweep der kun fjerner urefererede, ikke-beskyttede chunks.
4. **Single-writer lease** (`store.mjs`): prune kræver en gyldig lease med et
   fencing-token; en udløbet eller fremmed lease afvises, og et gammelt token
   kan ikke bruges.
5. **Crash-recovery** (`store.mjs`): intentionen journalføres før chunks
   skrives, og `recover()` genopbygger et committet snapshot, dropper et delvist
   put og rydder forældreløse chunk-filer.
6. **Backupblokke på den gennemprøvede backupløsning** (`backup.mjs`):
   `backup/src/vault.mjs` læses komponent for komponent, og
   `restoreDedupedBackup` genforener og verificerer hver komponent mod
   manifestet, før den skriver en gendannelse.
7. **Valgfri primær dedup og et forbud mod fletning** (`objects.mjs`):
   primære objekter kræver integritets- og restorevalidering plus en navngivet
   menneskelig godkendelse; forretningsposter gemmes hver for sig og flettes
   aldrig automatisk.
8. **Jobhændelser på idempotency-nøgle** (`events.mjs`): kun
   tenant + begivenheds-id + ressource + version inden for et tidsvindue
   undertrykkes; indholdet flettes aldrig.
9. **Besparelsesgate** (`measure.mjs`): `savingsActive` er kun sand når både
   integritetskontrollen og den fulde restore bestod, og et receipt med
   korruptioner kan ikke hævde en aktiv besparelse.

En målt delingsgrad, krypteringsydelse og oprydning på et levende objektlager er
`integration-dedup-live` og er **NOT RUN**; den kræver uafhængig
driftsverifikation.

## Konsekvenser

- Dedup-lageret indeholder kun chiffertekst og aldrig nøglen.
- En kompromitteret domænenøgle åbner ikke andre domæner eller kunder.
- Gendannelse efter dedup er verificeret mod backup-manifestet, så et brudt
  dedup-lager ikke kan producere en tavst forkert gendannelse.
- Prune kan ikke køre parallelt: leasen og fencing-tokenet giver én skriver.
- Forretningsposter kræver en ejerbesluttet, versionsstyret sammensmeltning
  uden for dedup-laget.
