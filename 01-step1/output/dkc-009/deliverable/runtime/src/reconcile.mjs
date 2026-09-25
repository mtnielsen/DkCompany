/**
 * DKC-009 — reconciliation efter et nedbrud.
 *
 * Et intent der er committet, men hvis outcome aldrig blev skrevet, er
 * `unknown`. Det må ikke genudføres ukritisk. I stedet undersøger en
 * reconciliation den eksterne ressource og afgør den faktiske tilstand.
 *
 * Denne helper kobler verbum → resolver. En resolver får intentet og
 * returnerer `{ outcome: "succeeded"|"failed", result }` (eller intet, hvis
 * sandheden ikke kan afgøres). Uden en resolver markeres intentet `unknown`.
 */
export function createReconciler({ journal, resolvers = {}, clock = () => Date.now() } = {}) {
  if (!journal) throw new Error("createReconciler kræver en action-journal");

  async function reconcileIntent(intent) {
    const resolver = resolvers[intent.verb] ?? null;
    return journal.reconcile({
      tenantId: intent.tenantId,
      idempotencyId: intent.idempotencyId,
      resolve: resolver ? (found) => resolver(found) : null,
    });
  }

  async function reconcileAll({ tenantId = null } = {}) {
    const pending = (journal.unresolved?.() ?? []).filter((intent) => tenantId === null || intent.tenantId === tenantId);
    const results = [];
    for (const intent of pending) {
      results.push({ intent, result: await reconcileIntent(intent) });
    }
    return { reconciledAt: new Date(clock()).toISOString(), count: results.length, results };
  }

  return { reconcileIntent, reconcileAll };
}
