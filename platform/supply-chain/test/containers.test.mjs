import { test } from "node:test";
import assert from "node:assert/strict";
import { checkContainers, checkDockerfile, parseDockerfile, loadBaseImageLock } from "../src/containers.mjs";
import { digestOfBytes } from "../src/digest.mjs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const NODE_DIGEST = digestOfBytes("node-base");
const DISTROLESS_DIGEST = digestOfBytes("distroless-base");
const baseLock = {
  images: [
    { repository: "docker.io/library/node", tag: "22", digest: NODE_DIGEST },
    { repository: "gcr.io/distroless/nodejs22-debian12", tag: "nonroot", digest: DISTROLESS_DIGEST },
  ],
};

const valid = `FROM docker.io/library/node@sha256:${NODE_DIGEST} AS build
WORKDIR /src
RUN node --version
FROM gcr.io/distroless/nodejs22-debian12:nonroot@sha256:${DISTROLESS_DIGEST}
USER nonroot
`;

test("parseDockerfile finder stages, args og bruger", () => {
  const parsed = parseDockerfile("FROM base AS a\nARG FOO\nFROM a AS b\nUSER 1000\n");
  assert.equal(parsed.stages.length, 2);
  assert.equal(parsed.stages[1].isStageRef, true);
  assert.deepEqual(parsed.args, ["FOO"]);
  assert.equal(parsed.user, "1000");
});

test("et korrekt Dockerfile accepteres", () => {
  assert.deepEqual(checkDockerfile("containers/app/Dockerfile", valid, baseLock), []);
});

test("uplåst base-image afvises", () => {
  const problems = checkDockerfile("x", "FROM node:22\nUSER nonroot\n", baseLock);
  assert.ok(problems.some((p) => /ikke pinnet/.test(p)));
});

test("pladsholder-digest afvises", () => {
  const problems = checkDockerfile("x", `FROM docker.io/library/node@sha256:${"a".repeat(64)}\nUSER nonroot\n`, baseLock);
  assert.ok(problems.some((p) => /pladsholder/.test(p)));
});

test("ukendt eller mismatchende base afvises", () => {
  const unknown = checkDockerfile("x", `FROM registry.example.org/x@sha256:${NODE_DIGEST}\nUSER nonroot\n`, baseLock);
  assert.ok(unknown.some((p) => /findes ikke/.test(p)));
  const mismatch = checkDockerfile("x", `FROM docker.io/library/node@sha256:${DISTROLESS_DIGEST}\nUSER nonroot\n`, baseLock);
  assert.ok(mismatch.some((p) => /matcher ikke/.test(p)));
});

test("root-bruger og hemmeligheder i build-args afvises", () => {
  assert.ok(checkDockerfile("x", `FROM docker.io/library/node@sha256:${NODE_DIGEST}\nUSER root\n`, baseLock).some((p) => /root/.test(p)));
  assert.ok(checkDockerfile("x", `FROM docker.io/library/node@sha256:${NODE_DIGEST}\nARG NPM_TOKEN\nUSER nonroot\n`, baseLock).some((p) => /hemmelighed/.test(p)));
});

test("repositoryets containere er pinnet og hærdet", () => {
  const result = checkContainers(repoRoot);
  assert.deepEqual(result.problems, []);
  assert.ok(result.catalog.images.length >= 5);
  assert.ok(loadBaseImageLock(repoRoot).images.length >= 2);
});
