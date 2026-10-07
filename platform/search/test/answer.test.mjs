import { test } from "node:test";
import assert from "node:assert/strict";
import { setupSearch, EMPLOYEE } from "./helpers.mjs";
import { retrieve } from "../src/retrieval.mjs";
import { buildAnswer } from "../src/answer.mjs";

test("et svar har kildehenvisning og usikkerhed", async () => {
  const { all, index, aclFor, close } = await setupSearch();
  try {
    const r = retrieve({ index, principal: EMPLOYEE, query: "arkitektur kontrolplan", policy: all.policy, aclResolver: aclFor });
    const answer = buildAnswer({ query: "arkitektur", principal: EMPLOYEE, retrieval: r, policy: all.policy });
    assert.ok(answer.citations.length >= 1);
    assert.ok(["low", "medium", "high"].includes(answer.uncertainty.level));
    assert.equal(answer.untrusted, true);
    assert.equal(answer.executable, false);
  } finally {
    await close();
  }
});

test("en artikel med et forfalsket værktøjskald aktiverer ikke et værktøj", async () => {
  const { all, index, aclFor, close } = await setupSearch();
  try {
    const r = retrieve({ index, principal: EMPLOYEE, query: "god artikel skrivning", policy: all.policy, aclResolver: aclFor });
    const answer = buildAnswer({ query: "god artikel", principal: EMPLOYEE, retrieval: r, policy: all.policy });
    assert.equal(answer.toolProposals.length, 0);
    assert.equal(answer.toolActivationDenied, true);
    assert.ok(answer.injectionFindings.includes("ignore-previous-da"));
    assert.ok(answer.injectionFindings.includes("tool-call-forgery"));
    assert.equal(answer.uncertainty.level, "high");
  } finally {
    await close();
  }
});

test("citationslisten indeholder kun autoriserede kilder", async () => {
  const { all, index, aclFor, close } = await setupSearch();
  try {
    const r = retrieve({ index, principal: EMPLOYEE, query: "lønforhandling HR", policy: all.policy, aclResolver: aclFor });
    const answer = buildAnswer({ query: "lønforhandling HR", principal: EMPLOYEE, retrieval: r, policy: all.policy });
    assert.ok(answer.citations.every((c) => !c.documentId.includes("hr-private")));
  } finally {
    await close();
  }
});
