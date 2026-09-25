/**
 * DKC-053 — dependency-resolveren. Beviser de fire krævede scenarier:
 * cyklus, inkompatibel version, fjernelse af delt afhængighed og BI-only
 * installation, plus ressourceknaphed, sikkerhedskerne og determinisme.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveDependencies, analyzeRemoval, detectCycles, topologicalOrder } from "../src/resolver.mjs";
import { loadComponents, loadProfiles, loadPlatforms, loadDeploymentProfiles } from "../src/catalog.mjs";
import { findProfile, findDeploymentProfile } from "../src/profiles.mjs";
import { loadServiceClasses } from "../../continuity/src/classes.mjs";
import { renderPreview } from "../src/preview.mjs";

const HUMAN = { subject: "oidc|test.person", name: "Test Person", role: "Tester" };

function comp(id, version, extra = {}) {
  return {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "ComponentManifest",
    metadata: { name: id, version, description: `Testkomponent ${id} med en gyldig beskrivelse.`, accountableHuman: HUMAN },
    componentType: "application",
    category: "other",
    securityCore: false,
    provides: { capabilities: [], dataServices: [] },
    supportProfile: { tier: "supported", supportWindow: "12 måneder" },
    platforms: { os: ["linux"], arch: ["x64"], runtime: ["node>=22 <23"] },
    resources: { cpuMillicores: 100, memoryMiB: 100, storageGiB: 1, nodes: 0 },
    requires: [],
    optionalRequires: [],
    conflicts: [],
    dataServices: [],
    migrations: [],
    download: [],
    operations: [],
    implementation: { status: "catalog-only", notes: "Test." },
    ...extra,
  };
}

function profile(overrides = {}) {
  return {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "InstallationProfile",
    metadata: { name: "test", version: "1.0.0", description: "Testprofil med en gyldig beskrivelse.", accountableHuman: HUMAN },
    profileType: "multiple-servers",
    deploymentProfileRef: "contracts/examples/deployment-profile.service.example.json",
    highAvailability: { enabled: true, acceptedNonHaServiceClass: false, externalBackupRequired: true },
    hostManagement: { optIn: true, component: "host-management" },
    securityCore: [],
    defaultApplications: [],
    optionalApplications: [],
    supportedPlatforms: ["linux-amd64-node22"],
    capacity: { cpuMillicores: 100000, memoryMiB: 100000, storageGiB: 10000, nodes: 100 },
    supportProfile: { tier: "supported", supportWindow: "12 måneder" },
    migration: { from: "a", to: "test", pathRef: "docs/x.md", expectedDowntimeMinutes: 0, steps: ["Et konkret trin i migrationen."] },
    ...overrides,
  };
}

const errCodes = (result) => result.errors.map((e) => e.code);

test("cyklus opdages før mutation", () => {
  const components = [
    comp("a", "1.0.0", { requires: [{ ref: "b", range: "*", reason: "a bruger b til at fuldføre arbejdet." }] }),
    comp("b", "1.0.0", { requires: [{ ref: "a", range: "*", reason: "b bruger a til at fuldføre arbejdet." }] }),
  ];
  const result = resolveDependencies({ components, profile: profile({ securityCore: ["a"] }) });
  assert.equal(result.ok, false);
  assert.ok(errCodes(result).includes("CYCLE"), JSON.stringify(result.errors));
  assert.equal(result.cycles.length, 1);
});

test("inkompatibel version opdages før mutation", () => {
  const components = [
    comp("app", "1.0.0", { requires: [{ ref: "lib", range: "^2.0.0", reason: "Appen kræver lib 2's API." }] }),
    comp("lib", "1.5.0"),
  ];
  const result = resolveDependencies({ components, profile: profile({ securityCore: ["app"] }) });
  assert.equal(result.ok, false);
  assert.ok(errCodes(result).includes("INCOMPATIBLE_VERSION"), JSON.stringify(result.errors));
});

test("den højeste version der opfylder alle krav vælges", () => {
  const components = [
    comp("a", "1.0.0", { requires: [{ ref: "lib", range: "^1.0.0", reason: "a kræver lib 1.x." }] }),
    comp("b", "1.0.0", { requires: [{ ref: "lib", range: ">=1.5.0 <2.0.0", reason: "b kræver mindst lib 1.5." }] }),
    comp("lib", "1.0.0"),
    comp("lib", "1.5.0"),
    comp("lib", "2.0.0"),
  ];
  const result = resolveDependencies({ components, profile: profile({ securityCore: ["a", "b"] }) });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const lib = result.entries.find((e) => e.id === "lib");
  assert.equal(lib.version, "1.5.0");
});

test("lock binder en eksakt version", () => {
  const components = [comp("a", "1.0.0", { requires: [{ ref: "lib", range: "^1.0.0", reason: "a kræver lib 1.x." }] }), comp("lib", "1.0.0"), comp("lib", "1.9.0")];
  const result = resolveDependencies({ components, profile: profile({ securityCore: ["a"] }), lock: { lib: "1.0.0" } });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.entries.find((e) => e.id === "lib").version, "1.0.0");
});

test("konflikt opdages før mutation", () => {
  const components = [
    comp("app-a", "1.0.0", { conflicts: [{ ref: "app-b", reason: "app-a og app-b deler de samme datakilder." }] }),
    comp("app-b", "1.0.0"),
  ];
  const result = resolveDependencies({ components, profile: profile({ securityCore: ["app-a", "app-b"] }) });
  assert.equal(result.ok, false);
  assert.ok(errCodes(result).includes("CONFLICT"), JSON.stringify(result.errors));
});

test("fjernelse af en delt afhængighed afvises med alle afhængige", () => {
  const components = [
    comp("app-a", "1.0.0", { requires: [{ ref: "shared", range: "^1.0.0", reason: "app-a bruger den fælles datatjeneste." }] }),
    comp("app-b", "1.0.0", { requires: [{ ref: "shared", range: "^1.0.0", reason: "app-b bruger den fælles datatjeneste." }] }),
    comp("shared", "1.0.0"),
  ];
  const p = profile({ securityCore: ["app-a", "app-b"] });
  const result = resolveDependencies({ components, profile: p, removed: ["shared"] });
  assert.equal(result.ok, false);
  const removedError = result.errors.find((e) => e.code === "REMOVED_SHARED_DEPENDENCY");
  assert.ok(removedError, JSON.stringify(result.errors));
  assert.match(removedError.message, /app-a/);
  assert.match(removedError.message, /app-b/);

  const impact = analyzeRemoval(result.entries, "shared").map((i) => i.id);
  assert.deepEqual(impact, ["app-a", "app-b"]);
});

test("utilstrækkelige ressourcer opdages før mutation", () => {
  const components = [comp("core", "1.0.0", { componentType: "security-core", securityCore: true, resources: { cpuMillicores: 500, memoryMiB: 500, storageGiB: 5, nodes: 1 } })];
  const result = resolveDependencies({ components, profile: profile({ securityCore: ["core"], capacity: { cpuMillicores: 100, memoryMiB: 100, storageGiB: 1, nodes: 0 } }) });
  assert.equal(result.ok, false);
  assert.ok(errCodes(result).includes("INSUFFICIENT_RESOURCES"), JSON.stringify(result.errors));
});

test("manglende obligatorisk sikkerhedskerne afvises", () => {
  const components = [comp("core", "1.0.0", { componentType: "security-core", securityCore: true })];
  const result = resolveDependencies({ components, profile: profile({ securityCore: [] }) });
  assert.equal(result.ok, false);
  assert.ok(errCodes(result).includes("SECURITY_CORE_MISSING"), JSON.stringify(result.errors));
});

test("manglende datatjenesteprovider afvises", () => {
  const components = [comp("app", "1.0.0", { dataServices: [{ id: "sql", kind: "relational", required: true, reason: "Appen kræver en relationel database." }] })];
  const result = resolveDependencies({ components, profile: profile({ securityCore: ["app"] }) });
  assert.equal(result.ok, false);
  assert.ok(errCodes(result).includes("MISSING_DATA_SERVICE_PROVIDER"), JSON.stringify(result.errors));
});

test("topologisk rækkefølge sætter afhængigheder først", () => {
  const components = [
    comp("top", "1.0.0", { requires: [{ ref: "mid", range: "*", reason: "top kræver mid." }] }),
    comp("mid", "1.0.0", { requires: [{ ref: "base", range: "*", reason: "mid kræver base." }] }),
    comp("base", "1.0.0"),
  ];
  const result = resolveDependencies({ components, profile: profile({ securityCore: ["top"] }) });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.ok(result.order.indexOf("base") < result.order.indexOf("mid"));
  assert.ok(result.order.indexOf("mid") < result.order.indexOf("top"));
});

test("cyklusdetektion er ren og stabil", () => {
  const index = new Map([
    ["a", [{ metadata: { name: "a" }, requires: [{ ref: "b" }], optionalRequires: [] }]],
    ["b", [{ metadata: { name: "b" }, requires: [{ ref: "a" }], optionalRequires: [] }]],
  ]);
  const chosen = new Map([["a", index.get("a")[0]], ["b", index.get("b")[0]]]);
  const cycles = detectCycles(chosen, index);
  assert.equal(cycles.length, 1);
  assert.deepEqual([...cycles[0]].sort(), ["a", "b"]);
});

test("BI-only på det rigtige katalog installerer kun BI og dens nødvendige afhængigheder", () => {
  const components = loadComponents();
  const profiles = loadProfiles();
  const deploymentProfiles = loadDeploymentProfiles();
  const p = findProfile(profiles, "small-vps");
  const deploymentProfile = findDeploymentProfile(deploymentProfiles, p.deploymentProfileRef);
  const result = resolveDependencies({ components, profile: p, selection: ["bi"], deploymentProfile, serviceClasses: loadServiceClasses() });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.safety.ok, true, JSON.stringify(result.safety.errors));
  for (const required of ["bi", "platform-core", "identity-broker", "audit-service", "analytics-store", "primary-database"]) {
    assert.ok(result.closure.includes(required), `BI-closure mangler '${required}': ${result.closure.join(", ")}`);
  }
  for (const forbidden of ["hr", "reporting", "communications", "host-management", "bi-legacy"]) {
    assert.ok(!result.closure.includes(forbidden), `BI-only må ikke indeholde '${forbidden}': ${result.closure.join(", ")}`);
  }
});

test("previewet er deterministisk", () => {
  const components = loadComponents();
  const profiles = loadProfiles();
  const deploymentProfiles = loadDeploymentProfiles();
  const p = findProfile(profiles, "small-vps");
  const previewInput = {
    profile: p,
    deploymentProfile: findDeploymentProfile(deploymentProfiles, p.deploymentProfileRef),
    platformId: "linux-amd64-node22",
    result: resolveDependencies({ components, profile: p, selection: ["bi", "hr"], deploymentProfile: findDeploymentProfile(deploymentProfiles, p.deploymentProfileRef), serviceClasses: loadServiceClasses() }),
  };
  assert.equal(renderPreview(previewInput), renderPreview(previewInput));
  assert.match(renderPreview(previewInput), /Installationspreview/);
});

test("platformmatricen kan slå den kørende maskine op", () => {
  const platforms = loadPlatforms().platforms;
  assert.ok(platforms.length >= 1);
  assert.ok(platforms.every((p) => p.testCommand));
});
