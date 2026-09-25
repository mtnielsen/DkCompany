/**
 * DKC-016 — indsamling af objektfiler til backup.
 *
 * Objekter er førsteparts filer under en objektmappe. Indsamlingen er
 * deterministisk (sorteret) og kan begrænses med et eksplicit include-filter,
 * så en backup ikke ved et uheld trækker hemmeligheder eller caches med.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function collectObjectFiles(dir, { include = null, exclude = [] } = {}) {
  if (!dir || !existsSync(dir)) return [];
  const files = [];

  function walk(abs, rel) {
    for (const entry of readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(join(abs, entry.name), childRel);
        continue;
      }
      if (!entry.isFile()) continue;
      if (include && !include(childRel)) continue;
      if (exclude.some((re) => re.test(childRel))) continue;
      files.push({ name: childRel, path: join(abs, entry.name), bytes: readFileSync(join(abs, entry.name)) });
    }
  }

  walk(dir, "");
  return files;
}
