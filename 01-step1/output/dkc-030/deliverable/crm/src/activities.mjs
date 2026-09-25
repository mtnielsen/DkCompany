/**
 * DKC-030 — kontaktaktiviteter.
 *
 * En aktivitet er en append-only, uforanderlig hændelse på en post. Den
 * registrerer hver tilstandsovergang (oprettet, opdateret, eksporteret,
 * slettet, dubletkonflikt) og kan aldrig omskrives.
 */
import { digestOf } from "../../runtime/src/digest.mjs";

/** Tilføj en aktivitet til en post. */
export function recordActivity({ store, reference, type, subject = null, actor = null, detail = null, at = null } = {}) {
  if (!store.getRecord(reference)) {
    const err = new Error(`aktiviteten peger på den ukendte post '${reference}'`);
    err.code = "unknown_record";
    throw err;
  }
  return store.appendActivity({ reference, type, subject, actor, detail, at });
}

/** Alle aktiviteter for en post, i tidsorden. */
export function listActivities({ store, reference } = {}) {
  return store.listActivities(reference).slice().sort((a, b) => a.at.localeCompare(b.at));
}

/** Deterministisk digest af en posts aktivitetshistorik. */
export function activityDigest({ store, reference } = {}) {
  return digestOf(listActivities({ store, reference }));
}
