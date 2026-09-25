# Cloud-uafhængig drift og offline-drift

Platformen skal kunne køre uden afhængighed af en bestemt cloud og uden internet
for de lokale kerneflows.

## Lokale kerneflows

Ved et internetudfald fortsætter:

- lokal autorisation og default-deny policy-beslutning,
- læsning og skrivning i den lokale database og det lokale objektlager,
- det beskyttede revisionsspor og logføringen,
- lokal backup og verificeret gendannelse, og
- lokal videnssøgning på eksisterende indeks uden modelkald.

## Eksterne afhængigheder

`catalog/offline-package.json` markerer hver ekstern afhængighed (model-API,
ekstern API eller opdateringskilde) med en `offlineBehavior` og en eksplicit
status. En utilgængelig funktion skal **vises tydeligt**; der findes ingen tavs
fallback. Enhver gateway-rute skal være markeret, ellers fejler kontrollen.

## Offlinepakken

Offlinepakken er selvstændig: den indeholder de nødvendige komponentartefakter
med digest og de lokale kerneflows. Nye releases og sikkerhedsopdateringer
sættes i kø, mens den kørende release fortsætter uændret.

## Verificér beredskabet

```bash
make lifecycle-check
node installer/src/lifecycle-cli.mjs offline
```
