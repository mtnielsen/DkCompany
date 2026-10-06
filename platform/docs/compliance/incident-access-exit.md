# Incidentproces, adgangsrevision, informationspligt og exit

DKC-022. Disse processer gør registerets poster til faktiske handlinger med
navngivne ejere. De indgår i evidens- og risikoregisteret og refereres fra
`docs/runbooks/incident-response.md` og `docs/runbooks/customer-exit.md`.

## Incidentproces

En hændelse håndteres efter [`docs/runbooks/incident-response.md`](../runbooks/incident-response.md).
Indberetningspligterne ligger i registeret med regime, frist, modtager og ejer:

- **GDPR art. 33** — inden 72 timer til tilsynsmyndigheden, ejer Platform Owner.
- **NIS2 art. 23** — tidlig advarsel inden 24 timer til CSIRT, ejer Security
  Owner.

Fristerne er dokumenterede krav; den faktiske brudøvelse og beslutningen om
anmeldelse/kommunikation kræver et navngivet menneske og er **NOT RUN** i dette
miljø.

## Adgangsrevision {#adgangsrevision}

Adgangsrevisionen følger en dokumenteret kadence (90 døgn), har en navngiven
ejer og en sammenfatning af fund. Formålet er at lukke inaktive konti, bekræfte
mindste privilegium og opdage indirekte adminveje. En revision er en
menneskelig handling; registeret bærer tidspunkt, ejer og fund.

## Informationspligt {#informationspligt}

Kunden informeres uden unødig forsinkelse, når en hændelse påvirker kundens
data, sammen med kendte konsekvenser og afhjælpende tiltag. Ansvaret ligger hos
Platform Owner, og proceduren er dokumenteret.

## Kundens exitprocedure

Ved afvikling af et kundeforhold:

1. kunden kan eksportere sine data i et dokumenteret format,
2. platformen sletter kundens data efter de aftalte frister og genanvender
   slettebeslutninger ved restore,
3. overgangsperioden er 90 dage, hvorefter adgang lukkes.

Proceduren er dokumenteret i [`docs/runbooks/customer-exit.md`](../runbooks/customer-exit.md)
og har en navngiven ejer. Sletningsdækningen pr. datalag leveres af
[`retention/deletion-policy.json`](../../retention/deletion-policy.json).

## Beslutninger i registeret {#dec-003}

Registerets beslutninger (`DEC-*`) er de konkrete valg bag processerne:
kadence og ejerskab for adgangsrevision, overførselsmekanisme og DPIA. Hver
beslutning har en ansvarlig person og — når den er truffet — navn, rolle, dato
og dokumentreference.
