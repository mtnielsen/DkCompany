/**
 * DKC-061 — holdbar, filbaseret butik for produktlivscyklussen.
 *
 * Butikken ligger på disk, så en genstart ikke mister den aktive release,
 * installerede komponenter, opdaterings- og fjernelsesforløb, supportbundles
 * eller epochs. Alle mutationer hæver en epoch, og der kan tages et snapshot før
 * en opdatering eller fjernelse, så en rollback kan gendanne både release,
 * komponenter og records.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { digestOf } from "../../runtime/src/digest.mjs";

const FILES = {
  state: "state.json",
  release: "release.json",
  components: "components.json",
  updates: "updates.json",
  removals: "removals.json",
  bundles: "bundles.json",
};

function empty() {
  return {
    release: { apiVersion: "contracts.platform/v1alpha1", kind: "LifecycleActiveRelease", release: null, updatedAt: null },
    components: { apiVersion: "contracts.platform/v1alpha1", kind: "LifecycleComponents", components: {} },
    updates: { apiVersion: "contracts.platform/v1alpha1", kind: "LifecycleUpdates", updates: {} },
    removals: { apiVersion: "contracts.platform/v1alpha1", kind: "LifecycleRemovals", removals: {} },
    bundles: { apiVersion: "contracts.platform/v1alpha1", kind: "LifecycleSupportBundles", bundles: {} },
  };
}

export class FileLifecycleStore {
  constructor(root) {
    this.root = root;
    this.data = empty();
    this.state = { epoch: 0, updatedAt: null, reason: null };
  }

  static open(root) {
    return new FileLifecycleStore(root).load();
  }

  load() {
    mkdirSync(this.root, { recursive: true });
    const read = (name) => {
      const path = join(this.root, name);
      return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
    };
    const base = empty();
    for (const key of Object.keys(base)) this.data[key] = read(FILES[key]) ?? base[key];
    this.state = read(FILES.state) ?? { epoch: 0, updatedAt: null, reason: null };
    return this;
  }

  persist() {
    mkdirSync(this.root, { recursive: true });
    const write = (name, value) => {
      const tmp = join(this.root, `${name}.tmp`);
      writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n");
      renameSync(tmp, join(this.root, name));
    };
    for (const key of Object.keys(this.data)) write(FILES[key], this.data[key]);
    write(FILES.state, this.state);
    return this;
  }

  epoch() {
    return this.state.epoch;
  }

  bump(reason, at = null) {
    this.state = { epoch: this.state.epoch + 1, updatedAt: at ?? new Date().toISOString(), reason };
    return this.state.epoch;
  }

  getActiveRelease() {
    return this.data.release.release;
  }

  setActiveRelease(releaseId, { at = null, reason = "update" } = {}) {
    this.data.release.release = releaseId;
    this.data.release.updatedAt = at;
    this.bump("release", at);
    this.persist();
    return releaseId;
  }

  getComponents() {
    return this.data.components.components;
  }

  setComponents(components, { at = null, reason = "update" } = {}) {
    this.data.components.components = { ...components };
    this.bump(reason, at);
    this.persist();
    return this.data.components.components;
  }

  upsertUpdate(update) {
    this.data.updates.updates[update.id] = update;
    this.bump("update", update.at ?? null);
    this.persist();
    return update;
  }

  getUpdate(id) {
    return this.data.updates.updates[id] ?? null;
  }

  listUpdates() {
    return Object.values(this.data.updates.updates);
  }

  upsertRemoval(removal) {
    this.data.removals.removals[removal.id] = removal;
    this.bump("removal", removal.at ?? null);
    this.persist();
    return removal;
  }

  getRemoval(id) {
    return this.data.removals.removals[id] ?? null;
  }

  listRemovals() {
    return Object.values(this.data.removals.removals);
  }

  saveBundle(bundle) {
    this.data.bundles.bundles[bundle.metadata.name] = bundle;
    this.bump("support-bundle", bundle.metadata.generatedAt ?? null);
    this.persist();
    return bundle;
  }

  listBundles() {
    return Object.values(this.data.bundles.bundles);
  }

  digest() {
    return digestOf({ release: this.data.release, components: this.data.components, state: this.state });
  }

  snapshot(destDir) {
    mkdirSync(destDir, { recursive: true });
    cpSync(this.root, destDir, { recursive: true });
    return destDir;
  }

  static restore(srcDir, destDir) {
    mkdirSync(destDir, { recursive: true });
    cpSync(srcDir, destDir, { recursive: true });
    return FileLifecycleStore.open(destDir);
  }

  static discard(root) {
    rmSync(root, { recursive: true, force: true });
  }
}
