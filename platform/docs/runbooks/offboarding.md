# Runbook — Offboarding af en identitet

Formål: lukke alle rettigheder for en afviklet identitet inden for den aftalte
frist og efterlade et revisbart spor. En skjult UI-side er ikke en kontrol.

## Forudsætninger

- Et navngivet menneske har godkendt afviklingen (change/HR-sag).
- Fristen (`deadlineSeconds`) er aftalt med HR/security.
- Den afviklede identitets `subject` er kendt.

## Trin

1. **Planlæg.** `planOffboarding({ subject, deadlineSeconds })` opretter en
   `OffboardingPlan` med de fem rettighedsklasser:
   `sessions`, `api-tokens`, `shares`, `scheduled-workflows`, `ai-tool-grants`.
2. **Udfør.** `executeOffboarding({ plan, store })` tilbagekalder eller
   deaktiverer hver rettighed i det holdbare lager. Kørslen er idempotent og må
   gerne gentages; allerede lukkede rettigheder markeres `already-revoked`.
3. **Kontrollér.** Resultatet skal være `status: complete`,
   `completeByDeadline: true` og `outstanding: []`. Ellers eskalér til
   security-owner; udestående rettigheder er en sikkerhedshændelse.
4. **Bevis.** Gem planen og resultatet med `auditRef` som evidens.

## Fristbrud

Hvis `now` er efter `deadlineAt`, udføres handlingen ikke og markeres `failed`,
og rettigheden forbliver udestående. Start forfra med en ny plan og eskalér.

## IdP og produktionskanaler

I dette miljø er der ingen rigtig IdP/tokenudbyder. `integration-idp-offboarding`
er NOT RUN. I produktion skal IdP-sessioner og udstedte tokens tilbagekaldes
gennem IdP'ens egen mekanisme, og leveringskanaler (SMTP/filshare/portal) skal
bekræftes separat (`integration-reporting-delivery` er ligeledes NOT RUN her).
