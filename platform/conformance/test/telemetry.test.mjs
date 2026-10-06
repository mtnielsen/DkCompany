import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createCollector } from "../src/collector.mjs";
import { repoRoot } from "../src/schemas.mjs";

const eventPath = join(repoRoot, "contracts", "examples", "cloud-event.example.json");

test("gyldigt CloudEvent accepteres end-to-end gennem collectoren", async () => {
  const collector = createCollector();
  const port = await collector.listen(0);
  try {
    const event = JSON.parse(readFileSync(eventPath, "utf8"));
    const res = await fetch(`http://127.0.0.1:${port}/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event),
    });
    assert.equal(res.status, 202);
    const body = await res.json();
    assert.equal(body.accepted, true);
    assert.equal(collector.received.length, 1);
    assert.equal(collector.received[0].tenantid, "acme");
  } finally {
    await collector.close();
  }
});

test("CloudEvent uden tenantid afvises med begrundelse", async () => {
  const collector = createCollector();
  const port = await collector.listen(0);
  try {
    const event = JSON.parse(readFileSync(eventPath, "utf8"));
    delete event.tenantid;
    const res = await fetch(`http://127.0.0.1:${port}/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.accepted, false);
    assert.ok(body.violations.some((v) => v.includes("tenantid")));
  } finally {
    await collector.close();
  }
});
