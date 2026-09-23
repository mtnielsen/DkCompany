/**
 * Reconcile mellem ønsket tilstand (git) og observeret tilstand (klynge).
 *
 * git er sandheden. Alt hvad der findes i klyngen men ikke i git slettes, og
 * alt hvad der afviger fra git føres tilbage. Det er det, der gør en ændring
 * uden om git til en ændring der forsvinder igen.
 */

export function keyOf(resource) {
  const ns = resource?.metadata?.namespace ?? "-";
  return `${resource.apiVersion}/${resource.kind}/${ns}/${resource.metadata.name}`;
}

/** Sand hvis alle felter i `desired` findes med samme værdi i `observed`. */
export function subsetEqual(desired, observed) {
  if (Array.isArray(desired)) {
    return Array.isArray(observed) && desired.length === observed.length && desired.every((v, i) => subsetEqual(v, observed[i]));
  }
  if (desired && typeof desired === "object") {
    if (!observed || typeof observed !== "object") return false;
    return Object.keys(desired).every((k) => subsetEqual(desired[k], observed[k]));
  }
  return desired === observed;
}

export function reconcile(desiredResources, observedResources) {
  const desired = new Map(desiredResources.map((r) => [keyOf(r), r]));
  const observed = new Map(observedResources.map((r) => [keyOf(r), r]));
  const actions = [];

  for (const [key, resource] of desired) {
    const live = observed.get(key);
    if (!live) actions.push({ op: "create", key, resource, detail: "findes ikke i klyngen" });
    else if (!subsetEqual(resource, live)) actions.push({ op: "revert", key, resource, detail: "afviger fra git" });
  }
  for (const [key, resource] of observed) {
    if (!desired.has(key)) actions.push({ op: "delete", key, resource, detail: "findes ikke i git" });
  }

  actions.sort((a, b) => a.key.localeCompare(b.key));
  return { inSync: actions.length === 0, actions, desiredCount: desired.size, observedCount: observed.size };
}

function setPath(object, path, value) {
  const parts = path.split(".");
  let node = object;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (node[part] === undefined) node[part] = {};
    node = node[part];
  }
  node[parts[parts.length - 1]] = value;
}

function matchesTarget(resource, target) {
  return (
    resource.apiVersion === target.apiVersion &&
    resource.kind === target.kind &&
    (resource.metadata?.namespace ?? "-") === (target.namespace ?? "-") &&
    resource.metadata?.name === target.name
  );
}

/** Anvend en simuleret drift-spec på den ønskede tilstand og returnér observeret tilstand. */
export function applyDrift(desiredResources, driftSpec) {
  let resources = structuredClone(desiredResources);
  for (const change of driftSpec.changes ?? []) {
    if (change.op === "add") {
      resources.push(structuredClone(change.resource));
      continue;
    }
    const index = resources.findIndex((r) => matchesTarget(r, change.resource));
    if (index === -1) continue;
    if (change.op === "delete") {
      resources.splice(index, 1);
    } else if (change.op === "set") {
      setPath(resources[index], change.path, change.value);
    } else {
      throw new Error(`ukendt drift-op: ${change.op}`);
    }
  }
  return resources;
}
