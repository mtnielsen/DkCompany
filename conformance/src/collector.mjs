#!/usr/bin/env node
/**
 * 0.3: Minimal CloudEvents-collector til at validere et testevent end-to-end.
 * Collectoren er ikke en app — den er testdobbelt for telemetriplanen, og
 * afviser enhver hændelse der mangler tenantid, traceid eller principal.
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { buildAjv, validate, SCHEMA_IDS } from "./schemas.mjs";

export function createCollector({ onEvent } = {}) {
  const { ajv } = buildAjv();
  const received = [];

  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", received: received.length }));
      return;
    }
    if (req.method !== "POST" || req.url !== "/events") {
      res.writeHead(404).end();
      return;
    }
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      let event;
      try {
        event = JSON.parse(body);
      } catch (err) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ accepted: false, error: `ugyldig JSON: ${err.message}` }));
        return;
      }
      const { ok, errors } = validate(ajv, SCHEMA_IDS.cloudEvent, event);
      if (!ok) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            accepted: false,
            error: "CloudEvent-envelope afvist",
            violations: errors.map((e) => `${(e.path || "/").trim()} ${e.message}`.trim()),
          })
        );
        return;
      }
      received.push(event);
      onEvent?.(event);
      res.writeHead(202, { "content-type": "application/json" });
      res.end(JSON.stringify({ accepted: true, id: event.id }));
    });
  });

  return {
    server,
    received,
    listen(port = 0) {
      return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server.address().port)));
    },
    close() {
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

async function main() {
  const port = Number(process.argv[2] ?? 4318);
  const collector = createCollector({ onEvent: (e) => console.log(JSON.stringify(e)) });
  const actual = await collector.listen(port);
  console.log(`CloudEvents-collector lytter på http://127.0.0.1:${actual}/events`);
  console.log("POST et CloudEvent hertil. Ctrl-C for at stoppe.");
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (invokedDirectly) main();
