# DKC-015 — containerbuild af agent-runtimen (CronJob-worker).
# Basen er pinnet på digest fra containers/base-images.lock.json.
FROM docker.io/library/node:22.22.1-bookworm-slim@sha256:4f77a690f2f8946ab16fe1e791a3ac0667ae1c3575c3e4d0d4589e9ed5bfaf3d AS build
WORKDIR /src
COPY runtime/ ./app/
COPY agent-registry/ ./agent-registry/
COPY data-protection/ ./data-protection/
COPY contracts/examples/agent-task.example.json ./contracts/examples/agent-task.example.json
COPY modules/dummy-ok/agents/backup-agent.json ./modules/dummy-ok/agents/backup-agent.json
RUN node --check ./app/src/cli.mjs

FROM gcr.io/distroless/nodejs22-debian12:nonroot@sha256:13593b7570658e8477de39e2f4a1dd25db2f836d68a0ba771251572d23bb4f8e
WORKDIR /app
COPY --from=build /src/app/ /app/
COPY --from=build /src/agent-registry/ /agent-registry/
COPY --from=build /src/data-protection/ /data-protection/
COPY --from=build /src/contracts/ /contracts/
COPY --from=build /src/modules/ /modules/
USER nonroot
ENTRYPOINT ["/nodejs/bin/node", "/app/src/cli.mjs"]
