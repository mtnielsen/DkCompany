/**
 * DKC-004 — lager for godkendelsesanmodninger.
 *
 * Godkendelser må ikke kun leve i processens hukommelse: et genstart må ikke
 * kunne bruges til at glemme en afvist eller tilbagekaldt beslutning, og en
 * `pending`-anmodning skal bevare sin serverstyrede binding.
 *
 * `createMemoryStore` bruges til enhedstests og til kortlivede processer.
 * `createFileStore` skriver hver anmodning atomisk (temp + rename) til en
 * mappe, så tilstanden overlever genstart. Filnavnet er en hash af id'et, så et
 * ondsindet id ikke kan skrive uden for mappen.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function clone(value) {
  return structuredClone(value);
}

export function createMemoryStore() {
  const items = new Map();
  return {
    kind: "memory",
    load() {
      return [...items.values()].map(clone);
    },
    get(id) {
      const value = items.get(id);
      return value ? clone(value) : null;
    },
    save(request) {
      items.set(request.id, clone(request));
      return request;
    },
    remove(id) {
      return items.delete(id);
    },
    ids() {
      return [...items.keys()];
    },
  };
}

function fileNameFor(id) {
  return `${createHash("sha256").update(String(id)).digest("hex")}.json`;
}

export function createFileStore({ dir, fileStore = null } = {}) {
  if (!dir) throw new Error("createFileStore kræver en mappe (dir)");
  const fs = fileStore ?? { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync };
  fs.mkdirSync(dir, { recursive: true });

  const pathFor = (id) => join(dir, fileNameFor(id));

  function load() {
    if (!fs.existsSync(dir)) return [];
    const requests = [];
    for (const name of fs.readdirSync(dir).sort()) {
      if (!name.endsWith(".json")) continue;
      const raw = fs.readFileSync(join(dir, name), "utf8");
      requests.push(JSON.parse(raw));
    }
    return requests;
  }

  return {
    kind: "file",
    dir,
    load,
    get(id) {
      const path = pathFor(id);
      if (!fs.existsSync(path)) return null;
      return JSON.parse(fs.readFileSync(path, "utf8"));
    },
    save(request) {
      const path = pathFor(request.id);
      const tmp = `${path}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(request, null, 2) + "\n");
      fs.renameSync(tmp, path); // atomisk: læseren ser enten før eller efter
      return request;
    },
    remove(id) {
      const path = pathFor(id);
      if (fs.existsSync(path)) fs.unlinkSync(path);
    },
    ids() {
      return load().map((r) => r.id);
    },
  };
}
