import { test } from "node:test";
import assert from "node:assert/strict";
import { createBoundedStore } from "../src/store.mjs";
import { createIngestor } from "../src/ingest.mjs";
import { createQueryService } from "../src/query.mjs";
import { createTelemetryServer } from "../src/server.mjs";
import { createGrafanaAdapter, createAdapterRegistry } from "../src/adapters.mjs";
import { makeEnvelope, metricEnvelope, registry, NOW, acmeOperator, createTestAuth } from "./support/fixtures.mjs";

async function start() {
  const store = createBoundedStore({ capacity: 100, retentionSeconds: 86400, clock: () => NOW });
  const ingestor = createIngestor({ store, registry, clock: () => NOW });
  const query = createQueryService({ store, clock: () => NOW });
  const { authenticator, token } = createTestAuth();
  const adapters = createAdapterRegistry([createGrafanaAdapter({ query })]);
  const server = createTelemetryServer({ ingestor, query, registry, authenticator, adapters, clock: () => NOW });
  const port = await server.listen(0);
  return { server, port, store, token };
}

const base = (port) => `http://127.0.0.1:${port}`;

test("autentificeret indtagning og tenant-scopet læsning end-to-end", async () => {
  const { server, port, token } = await start();
  try {
    const res = await fetch(`${base(port)}/v1/ingest`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token(acmeOperator)}` },
      body: JSON.stringify(makeEnvelope()),
    });
    assert.equal(res.status, 202);
    const body = await res.json();
    assert.equal(body.accepted, true);
    assert.equal(body.scope.tenantId, "acme");

    const view = await fetch(`${base(port)}/v1/views/operations`, { headers: { authorization: `Bearer ${token(acmeOperator)}` } });
    assert.equal(view.status, 200);
    const viewBody = await view.json();
    assert.equal(viewBody.scope.tenantId, "acme");
    assert.equal(viewBody.view, "operations");

    const health = await (await fetch(`${base(port)}/healthz`)).json();
    assert.equal(health.status, "ok");
    assert.equal(health.ingest.accepted, 1);

    const metrics = await fetch(`${base(port)}/metrics`);
    assert.equal(metrics.status, 200);
    assert.match(await metrics.text(), /telemetry_ingested_total 1/);

    const adapters = await (await fetch(`${base(port)}/v1/adapters`, { headers: { authorization: `Bearer ${token(acmeOperator)}` } })).json();
    assert.equal(adapters.adapters[0].id, "grafana");

    const collectors = await (await fetch(`${base(port)}/v1/collectors`, { headers: { authorization: `Bearer ${token(acmeOperator)}` } })).json();
    assert.equal(collectors.kind, "CollectorStatus");
  } finally {
    await server.close();
  }
});

test("krydskunde-læsning afvises af API'et", async () => {
  const { server, port, token } = await start();
  try {
    const res = await fetch(`${base(port)}/v1/views/operations?tenant=globex`, { headers: { authorization: `Bearer ${token(acmeOperator)}` } });
    assert.equal(res.status, 403);
  } finally {
    await server.close();
  }
});

test("manglende token, malformet envelope og tenant-mismatch afvises", async () => {
  const { server, port, token } = await start();
  try {
    assert.equal((await fetch(`${base(port)}/v1/views/operations`)).status, 401);
    const malformed = makeEnvelope();
    delete malformed.source;
    const bad = await fetch(`${base(port)}/v1/ingest`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token(acmeOperator)}` }, body: JSON.stringify(malformed) });
    assert.equal(bad.status, 422);
    const mismatch = makeEnvelope({ scope: { tenantId: "globex", environment: "staging" }, resource: "res://globex/service/x" });
    const denied = await fetch(`${base(port)}/v1/ingest`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token(acmeOperator)}` }, body: JSON.stringify(mismatch) });
    assert.equal(denied.status, 422);
  } finally {
    await server.close();
  }
});

test("et token for en anden audience afvises", async () => {
  const { server, port, token } = await start();
  try {
    const res = await fetch(`${base(port)}/v1/records`, { headers: { authorization: `Bearer ${token(acmeOperator, { aud: "andet" })}` } });
    assert.equal(res.status, 401);
  } finally {
    await server.close();
  }
});

test("serveren har ingen udførelsesrute", async () => {
  const { server, port, token } = await start();
  try {
    const res = await fetch(`${base(port)}/v1/execute`, { method: "POST", headers: { authorization: `Bearer ${token(acmeOperator)}` }, body: "{}" });
    assert.equal(res.status, 404);
  } finally {
    await server.close();
  }
});
