#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type FlowStatus = "active" | "planned" | "deprecated";
type Determinism = "deterministic" | "adaptive" | "exploratory" | "mutating-rehearsal";

interface ComponentDef {
  id: string;
  label?: string;
  files: string[];
  symbols?: string[];
  selectors?: string[];
  surfaces?: string[];
  staleChecks?: string[];
}

interface Glossary {
  version: number;
  components: ComponentDef[];
}

interface FlowDef {
  id: string;
  status: FlowStatus;
  tier: string;
  determinism: Determinism;
  owner: string;
  description: string;
  components: string[];
  steps: string[];
  assertions: string[];
  staleIf?: string[];
  probeFile?: string;
}

interface CheckSummary {
  ok: boolean;
  generatedAt: string;
  glossaryComponents: number;
  flows: Array<{ id: string; status: FlowStatus; determinism: Determinism; components: number }>;
  errors: string[];
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const flowDir = join(repoRoot, "tools/ui-probe/flows");
const glossaryPath = join(repoRoot, "tools/ui-probe/glossary/components.json");

async function main(): Promise<void> {
  const [command, ...args] = Bun.argv.slice(2);
  if (command !== "check") {
    console.error("usage: bun run tools/ui-probe/flowbook.ts check [--artifact-dir <dir>]");
    process.exit(2);
  }

  const artifactDir = readArg(args, "--artifact-dir");
  const summary = await checkFlowbook();
  const rendered = renderSummary(summary);
  console.log(rendered);

  if (artifactDir) {
    await mkdir(artifactDir, { recursive: true });
    await writeFile(join(artifactDir, "flowbook-summary.json"), JSON.stringify(summary, null, 2));
    await writeFile(join(artifactDir, "flowbook-summary.md"), rendered);
  }

  if (!summary.ok) process.exit(1);
}

async function checkFlowbook(): Promise<CheckSummary> {
  const errors: string[] = [];
  const glossary = await readJson<Glossary>(glossaryPath);
  const components = new Map<string, ComponentDef>();

  for (const component of glossary.components) {
    if (components.has(component.id)) errors.push(`Duplicate component id: ${component.id}`);
    components.set(component.id, component);
    for (const file of component.files ?? []) {
      const abs = join(repoRoot, file);
      if (!existsSync(abs)) {
        errors.push(`Component ${component.id} references missing file ${file}`);
        continue;
      }
      const text = await readFile(abs, "utf8");
      for (const symbol of component.symbols ?? []) {
        if (!text.includes(symbol)) errors.push(`Component ${component.id} symbol ${symbol} not found in ${file}`);
      }
    }
  }

  const flowFiles = (await readdir(flowDir)).filter((file) => file.endsWith(".json")).sort();
  const flows: FlowDef[] = [];
  const seenFlows = new Set<string>();
  for (const file of flowFiles) {
    const flow = await readJson<FlowDef>(join(flowDir, file));
    flows.push(flow);
    if (seenFlows.has(flow.id)) errors.push(`Duplicate flow id: ${flow.id}`);
    seenFlows.add(flow.id);
    validateFlow(flow, file, components, errors);
  }

  return {
    ok: errors.length === 0,
    generatedAt: new Date().toISOString(),
    glossaryComponents: components.size,
    flows: flows.map((flow) => ({
      id: flow.id,
      status: flow.status,
      determinism: flow.determinism,
      components: flow.components.length,
    })),
    errors,
  };
}

function validateFlow(flow: FlowDef, file: string, components: Map<string, ComponentDef>, errors: string[]): void {
  const statuses: FlowStatus[] = ["active", "planned", "deprecated"];
  const determinism: Determinism[] = ["deterministic", "adaptive", "exploratory", "mutating-rehearsal"];
  if (!flow.id) errors.push(`${file} missing id`);
  if (!statuses.includes(flow.status)) errors.push(`${flow.id} has invalid status ${flow.status}`);
  if (!determinism.includes(flow.determinism)) errors.push(`${flow.id} has invalid determinism ${flow.determinism}`);
  if (!flow.description) errors.push(`${flow.id} missing description`);
  if (!Array.isArray(flow.components) || flow.components.length === 0) errors.push(`${flow.id} must reference components`);
  for (const componentId of flow.components ?? []) {
    if (!components.has(componentId)) errors.push(`${flow.id} references unknown component ${componentId}`);
  }
  if (!Array.isArray(flow.steps) || flow.steps.length === 0) errors.push(`${flow.id} must define steps`);
  if (!Array.isArray(flow.assertions) || flow.assertions.length === 0) errors.push(`${flow.id} must define assertions`);
  if (flow.status === "active") {
    if (!flow.probeFile) errors.push(`${flow.id} is active but has no probeFile`);
    else if (!existsSync(join(repoRoot, flow.probeFile))) errors.push(`${flow.id} active probeFile is missing: ${flow.probeFile}`);
  }
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

function readArg(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? null : null;
}

function renderSummary(summary: CheckSummary): string {
  const flows = summary.flows.map((flow) => `- ${flow.status} ${flow.id} (${flow.determinism}, ${flow.components} components)`).join("\n");
  const errors = summary.errors.length ? summary.errors.map((error) => `- ${error}`).join("\n") : "- none";
  return `# UI Flowbook Check

Generated: ${summary.generatedAt}
Status: ${summary.ok ? "ok" : "failed"}
Components: ${summary.glossaryComponents}

## Flows

${flows}

## Errors

${errors}
`;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
