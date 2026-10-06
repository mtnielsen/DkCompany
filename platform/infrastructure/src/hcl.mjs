/**
 * DKC-015 — statisk kontrol af OpenTofu-modulet.
 *
 * Da `tofu`/`terraform` ikke er installeret i dette miljø, kan modulet ikke
 * planlægges her. Denne kontrol læser HCL'en som tekst og håndhæver de
 * invariants, der ellers ville være en menneskelig påstand: pinnede providere,
 * default-deny firewall, krypteret storage, privat netværk, ingen
 * klartekst-hemmeligheder og et sensitivt kubeconfig-output.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const IAC_DIR = "infrastructure/iac/small-vps";

/** Find blokke `keyword { ... }` og returnér deres indre tekst (brace-matchet). */
export function extractBlocks(text, keyword) {
  const blocks = [];
  const pattern = new RegExp(`\\b${keyword}\\b[^{]*\\{`, "g");
  let match;
  while ((match = pattern.exec(text))) {
    let depth = 0;
    let i = match.index + match[0].length - 1;
    const start = i + 1;
    for (; i < text.length; i++) {
      if (text[i] === "{") depth += 1;
      else if (text[i] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    blocks.push(text.slice(start, i));
  }
  return blocks;
}

function readAll(dir) {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry.endsWith(".tf") || entry.endsWith(".tfvars") || entry.endsWith(".yaml")) files.push({ file: entry, text: readFileSync(full, "utf8") });
  }
  return files;
}

export function checkIac(root) {
  const dir = join(root, IAC_DIR);
  const problems = [];
  const sources = readAll(dir);
  if (sources.length === 0) return { ok: false, problems: [`${IAC_DIR} indeholder ingen IaC-filer`] };
  const tf = sources.filter((s) => s.file.endsWith(".tf")).map((s) => s.text).join("\n");
  const all = sources.map((s) => s.text).join("\n");

  if (!/required_version\s*=/.test(tf)) problems.push("mangler en pinnet terraform.required_version");

  const providers = extractBlocks(tf, "provider");
  if (providers.length === 0) problems.push("mangler provider-blokke");
  for (const block of providers) {
    const name = /^\s*"([^"]+)"/.exec(block)?.[1] ?? "?";
    if (!/\bversion\s*=/.test(block)) problems.push(`provider '${name}' er ikke versionlåst`);
  }

  for (const required of [
    ['resource "hcloud_network"'],
    ['resource "hcloud_firewall"'],
    ['resource "hcloud_server"'],
    ['resource "hcloud_volume"'],
    ['resource "helm_release" "cert_manager"'],
    ['resource "helm_release" "external_secrets"'],
    ['resource "kubernetes_namespace"'],
    ['resource "helm_release" "argocd"'],
  ]) {
    if (!tf.includes(required[0])) problems.push(`modulet mangler ${required[0]}`);
  }

  const firewall = extractBlocks(tf, "hcloud_firewall")[0] ?? "";
  const rules = extractBlocks(firewall, "rule");
  if (rules.length === 0) problems.push("firewall har ingen regler (må ikke være åben som standard)");
  let hasHttps = false;
  for (const rule of rules) {
    const direction = /direction\s*=\s*"([^"]+)"/.exec(rule)?.[1];
    const port = /port\s*=\s*"([^"]+)"/.exec(rule)?.[1];
    const sources = /source_ips\s*=\s*\[([^\]]*)\]/.exec(rule)?.[1] ?? "";
    if (direction === "in" && ["0-65535", "any", "all"].includes(port)) problems.push("firewall åbner alle porte for indgående trafik");
    if (direction === "in" && port === "443" && /0\.0\.0\.0\/0/.test(sources)) hasHttps = true;
    if (direction === "in" && port === "22" && /0\.0\.0\.0\/0/.test(sources)) problems.push("SSH må ikke åbnes for 0.0.0.0/0");
  }
  if (!hasHttps) problems.push("firewall mangler en indgående HTTPS-regel (443) fra internettet");

  if (!/variable\s+"encryption_enabled"/.test(tf)) problems.push("mangler variablen encryption_enabled");
  if (!/encrypted\s*=\s*tostring\(var\.encryption_enabled\)/.test(tf)) problems.push("storage bærer ikke en krypteringsmarkering styret af encryption_enabled");

  const literalSecret = /(?<![.\w])(password|api_token|secret_key|private_key|client_secret|access_token)\s*=\s*"(?!var\.|local\.|data\.|vault\.)[^"]+"/gi;
  for (const source of sources) {
    const found = [...source.text.matchAll(literalSecret)].map((m) => m[1]);
    if (found.length) problems.push(`${source.file}: klartekst-hemmelighed(er) i IaC (${[...new Set(found)].join(", ")})`);
  }

  if (!/output\s+"kubeconfig"\s*\{[\s\S]*?sensitive\s*=\s*true/.test(tf)) problems.push("kubeconfig-output skal være markeret sensitive");

  const envDir = join(dir, "env");
  if (!existsSync(envDir)) problems.push("mangler env/<miljø>.tfvars");
  else {
    for (const env of ["dev", "staging", "prod"]) {
      const path = join(envDir, `${env}.tfvars`);
      if (!existsSync(path)) {
        problems.push(`mangler env/${env}.tfvars`);
        continue;
      }
      const text = readFileSync(path, "utf8");
      if (!/encryption_enabled\s*=\s*true/.test(text)) problems.push(`env/${env}.tfvars: encryption_enabled skal være true`);
      const admin = /admin_cidr\s*=\s*"([^"]+)"/.exec(text)?.[1];
      if (!admin) problems.push(`env/${env}.tfvars: mangler admin_cidr`);
      else if (admin === "0.0.0.0/0") problems.push(`env/${env}.tfvars: admin_cidr må ikke være 0.0.0.0/0`);
    }
  }

  return { ok: problems.length === 0, problems };
}
