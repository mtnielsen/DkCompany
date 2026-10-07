# DKC-014 — containerbuild af ai-gateway.
# Basen er pinnet på digest fra containers/base-images.lock.json. Selve
# buildet kræver Docker og er registreret NOT RUN i dette miljø.
FROM docker.io/library/node:22.22.1-bookworm-slim@sha256:4f77a690f2f8946ab16fe1e791a3ac0667ae1c3575c3e4d0d4589e9ed5bfaf3d AS build
WORKDIR /src
COPY gateway/ ./app/
RUN node --check /app/src/cli.mjs

FROM gcr.io/distroless/nodejs22-debian12:nonroot@sha256:13593b7570658e8477de39e2f4a1dd25db2f836d68a0ba771251572d23bb4f8e
WORKDIR /app
COPY --from=build /src/app/ /app/
USER nonroot
EXPOSE 8283
ENTRYPOINT ["/nodejs/bin/node", "/app/src/cli.mjs"]
