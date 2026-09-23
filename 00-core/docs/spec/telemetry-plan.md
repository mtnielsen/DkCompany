# Telemetriplanen

**Kontrakter:** [`contracts/telemetry.schema.json`](../../contracts/telemetry.schema.json) (modulblok), [`contracts/cloud-event.schema.json`](../../contracts/cloud-event.schema.json) (envelope)
**Backlog:** 0.3

## Formål

Gøre menneske- og agenthandlinger sammenlignelige i én log. En agenthandling er ikke en særlig slags hændelse — den er den samme hændelse med en anden `principal.kind`.

## To lag

1. **OTel** til traces, metrics og logs. Alle tre signaler er obligatoriske.
2. **CloudEvents 1.0** til forretnings- og governancehændelser, med platformens extension-attributter.

## Den obligatoriske envelope

Hver hændelse skal bære:

| Attribut | Betydning |
| --- | --- |
| `tenantid` | Hvilken tenant hændelsen tilhører. Wire-form af `tenant_id`. |
| `traceid` | W3C trace-id (32 hex). Binder hændelsen til trace og audit-log. |
| `principal` | Hvem/hvad der handlede: `human`, `agent` eller `service`. |

CloudEvents tillader kun lowercase alfanumeriske extension-navne, derfor `tenantid`/`traceid` på wire og `tenant_id`/`trace_id` i prosa.

### Principal

```json
{
  "kind": "agent",
  "id": "spiffe://platform.example.org/agents/dummy-ok-upgrader",
  "autonomyClass": "A3",
  "onBehalfOf": { "kind": "group", "id": "platform-approvers" }
}
```

`onBehalfOf` er påkrævet i praksis for agenthandlinger: der skal være et menneske eller en gruppe, der bærer ansvaret.

## Collector

Testdobbelten i [`conformance/src/collector.mjs`](../../conformance/src/collector.mjs) modtager hændelser på `POST /events`, validerer envelopen og afviser med en liste af brud. Den bruges af `make telemetry-test` til at bevise end-to-end-flowet uden en rigtig collector.

```bash
make telemetry-test
# ✔ gyldigt CloudEvent accepteres end-to-end gennem collectoren
# ✔ CloudEvent uden tenantid afvises med begrundelse
```

## Acceptkriterier (0.3)

- [x] CloudEvents-schema committet.
- [x] Testevent valideres end-to-end gennem collectoren (`conformance/test/telemetry.test.mjs`).
