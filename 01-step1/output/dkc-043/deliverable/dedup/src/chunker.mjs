/**
 * DKC-043 — indholdsdefineret chunking (content-defined chunking, CDC).
 *
 * Chunkgrænser udledes af indholdet med et gear-hash, ikke af faste
 * offset-intervaller. Det gør chunkingen robust over for indsættelser og
 * sletninger: en ændring tidligt i en fil skubber kun grænser i nærheden af
 * ændringen, så resten af filen fortsat deler chunks med den tidligere version.
 *
 * Chunkingen er deterministisk (samme bytes giver samme chunks, uanset
 * filnavn, tid eller proces), hvilket er en forudsætning for at en adresse
 * kan genbruges på tværs af snapshots inden for samme dedup-domæne.
 *
 * Modulet kender intet til kryptering eller leaser; det er ren, testbar
 * opdeling. `store.mjs` krypterer og referencetæller de enkelte chunks.
 */
import { createHash } from "node:crypto";

export class ChunkerError extends Error {
  constructor(message, code = "chunker_error") {
    super(message);
    this.name = "ChunkerError";
    this.code = code;
  }
}

/** Deterministisk gear-tabel udledt af en fast seed (ingen tilfældighed). */
function makeGear(seed) {
  const gear = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    gear[i] = createHash("sha256").update(`${seed}:${i}`).digest().readUInt32BE(0);
  }
  return gear;
}

const GEAR = makeGear("dkc-043-gear-cdc-v1");

export const CHUNKER_ALGORITHM = "gear-cdc-sha256-v1";
export const DEFAULT_CHUNKER = Object.freeze({ minSizeBytes: 512, averageSizeBytes: 2048, maxSizeBytes: 8192 });

export function sha256Hex(input) {
  return createHash("sha256").update(input).digest("hex");
}

function positiveInt(value, name) {
  if (!Number.isInteger(value) || value <= 0) throw new ChunkerError(`${name} skal være et positivt heltal`, "bad_param");
  return value;
}

/**
 * Opdel `buffer` i indholdsdefinerede chunks.
 *
 * @returns {Array<{offset:number,length:number,sha256:string,buffer:Buffer}>}
 */
export function chunkBuffer(buffer, params = {}) {
  const minSizeBytes = positiveInt(params.minSizeBytes ?? DEFAULT_CHUNKER.minSizeBytes, "minSizeBytes");
  const averageSizeBytes = positiveInt(params.averageSizeBytes ?? DEFAULT_CHUNKER.averageSizeBytes, "averageSizeBytes");
  const maxSizeBytes = positiveInt(params.maxSizeBytes ?? DEFAULT_CHUNKER.maxSizeBytes, "maxSizeBytes");
  if (!(minSizeBytes <= averageSizeBytes && averageSizeBytes <= maxSizeBytes)) {
    throw new ChunkerError("chunkstørrelser skal opfylde min <= gennemsnit <= max", "bad_param");
  }
  const buf = Buffer.from(buffer);
  if (buf.length === 0) return [];

  const avgBits = Math.max(1, Math.min(30, Math.round(Math.log2(averageSizeBytes))));
  const mask = (1 << avgBits) - 1;
  const chunks = [];
  let start = 0;
  let hash = 0;

  for (let i = 0; i < buf.length; i += 1) {
    hash = ((hash << 1) + GEAR[buf[i]]) >>> 0;
    const length = i - start + 1;
    const boundary = length >= minSizeBytes && (hash & mask) === 0;
    if (boundary || length >= maxSizeBytes || i === buf.length - 1) {
      const slice = buf.subarray(start, i + 1);
      chunks.push({ offset: start, length, sha256: sha256Hex(slice), buffer: slice });
      start = i + 1;
      hash = 0;
    }
  }
  return chunks;
}

/** Genforen chunks i rækkefølge og verificér hver chunks digest undervejs. */
export function joinChunks(chunks) {
  const parts = [];
  for (const chunk of chunks) {
    if (sha256Hex(chunk.buffer) !== chunk.sha256) {
      throw new ChunkerError(`chunk ved offset ${chunk.offset} matcher ikke sin digest`, "chunk_digest_mismatch");
    }
    parts.push(chunk.buffer);
  }
  return Buffer.concat(parts);
}
