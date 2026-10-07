# Enterprise- og branchepakker — rapport

> Genereret af `make enterprise-render` som en deterministisk kontrol. **Målt:** nej — en faktisk testkunde, en underskrevet aftale og en bekræftet faglig/sektor-/AI-vurdering kræver en ekstern kilde.

- **Genereret:** 2026-03-01T00:00:00Z
- **Pakker:** 5 (5 blokerede, 0 implementerbare)
- **Fælles sikkerhedskontrakter:** delte (small-vps, ha-cluster, enterprise-dedicated)
- **Højrisiko-AI med særskilt vurdering:** 1
- **Katalogposter der ikke er byggeopgaver:** bi, finance, hr, invoicing, payment, reporting, time, webshop

## Prioritering efter efterspørgsel og TCO

| # | Pakke | Efterspørgsel | TCO (12 mdr.) | Score |
| --- | --- | --- | --- | --- |
| 1 | Handels- og webshoppakke (`retail-commerce`) | 4 | 15535.6 (team) | 3984 |
| 2 | Feltservicepakke (`field-service`) | 2 | 15535.6 (team) | 1984 |
| 3 | Enterprise-kernepakke (`enterprise-core`) | 2 | 58923.2 (enterprise) | 1941 |
| 4 | Produktionspakke (`manufacturing`) | 2 | 58923.2 (enterprise) | 1941 |
| 5 | Reguleret omsorgspakke (`regulated-care`) | 2 | 58923.2 (enterprise) | 1941 |

## Pakker

| Pakke | Segment | Basisprofil | Implementerbar | Testkunde | Højrisiko-AI | Blokeringer |
| --- | --- | --- | --- | --- | --- | --- |
| Enterprise-kernepakke (`enterprise-core`) | enterprise | enterprise-dedicated | nej | Enterprise Nord A/S (identified) | — | 6 |
| Handels- og webshoppakke (`retail-commerce`) | commerce | ha-cluster | nej | Butik Nord ApS (identified) | — | 7 |
| Feltservicepakke (`field-service`) | field-service | ha-cluster | nej | Service Teknik A/S (identified) | — | 10 |
| Produktionspakke (`manufacturing`) | manufacturing | enterprise-dedicated | nej | Fabrik Syd A/S (identified) | — | 8 |
| Reguleret omsorgspakke (`regulated-care`) | regulated | enterprise-dedicated | nej | Omsorg Pleje A/S (identified) | required | 8 |

## Kapabiliteter og resolver

| Pakke | Krævede | Manglende | Forbudte til stede | Kontrolplan |
| --- | --- | --- | --- | --- |
| `enterprise-core` | accounting, audit-log, bi, control-plane, finance, hr, identity-oidc, invoicing, reporting, time-tracking | — | — | audit-log, control-plane, identity-oidc, policy-decision |
| `retail-commerce` | audit-log, commerce, control-plane, finance, identity-oidc, invoicing, payment, time-tracking, webshop | — | — | audit-log, control-plane, identity-oidc, policy-decision |
| `field-service` | audit-log, control-plane, field-dispatch, hr, identity-oidc, messaging, offline-sync, time-tracking | field-dispatch, offline-sync | — | audit-log, control-plane, identity-oidc, policy-decision |
| `manufacturing` | accounting, audit-log, bi, control-plane, finance, identity-oidc, invoicing, mes, plm, reporting, time-tracking | mes, plm | — | audit-log, control-plane, identity-oidc, policy-decision |
| `regulated-care` | audit-log, control-plane, finance, hr, identity-oidc, invoicing, reporting, time-tracking | — | — | audit-log, control-plane, identity-oidc, policy-decision |

## Dataejerskab og isolation

### Enterprise-kernepakke (`enterprise-core`)

- **Isolation:** dedicated (dedikerede databaser: true, netværkssegmentering: true, immutable audit: true)
- **Produktejer:** Erik Eriksen (Enterprise Delivery Owner)
- **Testkunde:** Enterprise Nord A/S — identified (syntetisk)
- **Dataejerskab:** financial → Erik Eriksen; personal → Cecilia Christensen
- **Faglige krav:** danish-accounting:unreviewed, payroll:unreviewed, e-invoicing:pending
- **Sektorregler:** — (not-applicable)
- **Højrisiko-AI:** ikke anvendelig
- **Katalogposter der IKKE er byggeopgaver:** hr, bi, reporting, finance, invoicing, time
- **Byggeopgaver fra eksplicit ordre:** 0

### Handels- og webshoppakke (`retail-commerce`)

- **Isolation:** enhanced (dedikerede databaser: true, netværkssegmentering: true, immutable audit: false)
- **Produktejer:** Maja Marked (Commerce Product Owner)
- **Testkunde:** Butik Nord ApS — identified (syntetisk)
- **Dataejerskab:** financial → Maja Marked; personal → Ditte DPO
- **Faglige krav:** consumer-law:unreviewed, vat:pending, payment-approved-service:unreviewed
- **Sektorregler:** forbrugeraftaler (required)
- **Højrisiko-AI:** ikke anvendelig
- **Katalogposter der IKKE er byggeopgaver:** webshop, payment, invoicing, finance, time
- **Byggeopgaver fra eksplicit ordre:** 0

### Feltservicepakke (`field-service`)

- **Isolation:** standard (dedikerede databaser: false, netværkssegmentering: false, immutable audit: false)
- **Produktejer:** Frida Feltservice (Field Service Product Owner)
- **Testkunde:** Service Teknik A/S — identified (syntetisk)
- **Dataejerskab:** personal → Frida Feltservice
- **Faglige krav:** worker-safety:unreviewed, gdpr-field:unreviewed
- **Sektorregler:** arbejdsmiljø (required)
- **Højrisiko-AI:** ikke anvendelig
- **Katalogposter der IKKE er byggeopgaver:** time, hr
- **Byggeopgaver fra eksplicit ordre:** 0

### Produktionspakke (`manufacturing`)

- **Isolation:** dedicated (dedikerede databaser: true, netværkssegmentering: true, immutable audit: true)
- **Produktejer:** Morten Produktion (Manufacturing Product Owner)
- **Testkunde:** Fabrik Syd A/S — identified (syntetisk)
- **Dataejerskab:** operational → Morten Produktion; financial → Erik Eriksen
- **Faglige krav:** product-safety:unreviewed, machine-safety-ce:unreviewed
- **Sektorregler:** maskinsikkerhed, produktsikkerhed (required)
- **Højrisiko-AI:** ikke anvendelig
- **Katalogposter der IKKE er byggeopgaver:** finance, invoicing, time, bi, reporting
- **Byggeopgaver fra eksplicit ordre:** 0

### Reguleret omsorgspakke (`regulated-care`)

- **Isolation:** dedicated (dedikerede databaser: true, netværkssegmentering: true, immutable audit: true)
- **Produktejer:** Rikke Reguleret (Regulated Industries Product Owner)
- **Testkunde:** Omsorg Pleje A/S — identified (syntetisk)
- **Dataejerskab:** special-category → Rikke Reguleret; personal → Ditte DPO
- **Faglige krav:** sector-health:unreviewed, special-category:pending, ai-act-high-risk:unreviewed
- **Sektorregler:** sundhedsret, databeskyttelse (required)
- **Højrisiko-AI:** required
- **Katalogposter der IKKE er byggeopgaver:** hr, time, finance, invoicing, reporting
- **Byggeopgaver fra eksplicit ordre:** 0

