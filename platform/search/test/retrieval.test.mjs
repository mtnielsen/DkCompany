import { test } from "node:test";
import assert from "node:assert/strict";
import { setupSearch, EMPLOYEE, HR, GLOBEX } from "./helpers.mjs";
import { retrieve, embeddingRetrieve } from "../src/retrieval.mjs";

const PRIVATE = ["bookstack-acme:page-hr-private", "bookstack-acme:page-hr-oncall", "bookstack-acme:page-salary-process"];

test("privat HR-side optræder ikke i retrieval eller embedding for en uautoriseret medarbejder", async () => {
  const { all, index, aclFor, close } = await setupSearch();
  try {
    const r = retrieve({ index, principal: EMPLOYEE, query: "lønforhandling HR fortrolig", policy: all.policy, aclResolver: aclFor });
    const e = embeddingRetrieve({ index, principal: EMPLOYEE, query: "lønforhandling HR fortrolig", policy: all.policy, aclResolver: aclFor });
    for (const id of PRIVATE) {
      assert.ok(!r.results.some((x) => x.document.id === id), `retrieval lækkede ${id}`);
      assert.ok(!e.results.some((x) => x.document.id === id), `embedding lækkede ${id}`);
    }
  } finally {
    await close();
  }
});

test("en HR-medarbejder med gruppe og klarering kan se den private side", async () => {
  const { all, index, aclFor, close } = await setupSearch();
  try {
    const r = retrieve({ index, principal: HR, query: "lønforhandling HR fortrolig", policy: all.policy, aclResolver: aclFor });
    assert.ok(r.results.some((x) => x.document.id === "bookstack-acme:page-hr-private"));
  } finally {
    await close();
  }
});

test("tenantadskillelse holder i begge retninger", async () => {
  const { all, index, aclFor, close } = await setupSearch();
  try {
    const acme = retrieve({ index, principal: EMPLOYEE, query: "kontrakt onboarding", policy: all.policy, aclResolver: aclFor });
    const globex = retrieve({ index, principal: GLOBEX, query: "kontrakt onboarding", policy: all.policy, aclResolver: aclFor });
    assert.ok(acme.results.every((x) => x.document.tenantId === "acme"));
    assert.ok(globex.results.every((x) => x.document.tenantId === "globex"));
  } finally {
    await close();
  }
});

test("en tilbagekaldt rettighed håndhæves ved revalidering ved læsning", async () => {
  const { all, index, mock, aclFor, close } = await setupSearch();
  try {
    const before = retrieve({ index, principal: EMPLOYEE, query: "arkitektur kontrolplan", policy: all.policy, aclResolver: aclFor });
    assert.ok(before.results.some((x) => x.document.id === "bookstack-acme:page-architecture"));
    mock.setPermissions("acme", "page-architecture", { readGroups: ["hr"], readSubjects: [], denyGroups: [], denySubjects: [] });
    const after = retrieve({ index, principal: EMPLOYEE, query: "arkitektur kontrolplan", policy: all.policy, aclResolver: aclFor });
    assert.ok(!after.results.some((x) => x.document.id === "bookstack-acme:page-architecture"));
  } finally {
    await close();
  }
});

test("en utilgængelig ACL-resolver giver fail-closed", async () => {
  const { all, index, close } = await setupSearch();
  try {
    const r = retrieve({ index, principal: EMPLOYEE, query: "arkitektur", policy: all.policy, aclResolver: () => { throw new Error("nede"); } });
    assert.equal(r.results.length, 0);
    assert.ok(r.accessDecision.deniedDocuments > 0);
  } finally {
    await close();
  }
});
