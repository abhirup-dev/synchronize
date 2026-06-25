import type { Peer, StatusResponse } from "../api/types.ts";

// Pure rendering/evaluation for `synchronize remote status` and `remote doctor`.
// Kept side-effect-free (the CLI does the fetching) so the formatting and the
// readiness rules are unit-testable.

export interface StatusReportInput {
  /** How the client reached the daemon. */
  source: { remoteUrl: string | null; profileName: string | null };
  status: StatusResponse;
  peers: Peer[];
  /** This client's compiled API_VERSION, to flag a hub/client mismatch. */
  localApiVersion: number;
}

const PRESENCE_GLYPH: Record<string, string> = {
  working: "●",
  idle: "○",
  initializing: "◐",
  online: "●",
  offline: "·",
};

/** Render the hub summary + a roster grouped by the machine each peer is on. */
export function renderStatusReport(input: StatusReportInput): string[] {
  const { status, peers } = input;
  const hubMachine = status.machine ?? "(unknown)";
  const sha = status.provenance.git_sha ? status.provenance.git_sha.slice(0, 8) : "nogit";
  const dirty = status.provenance.git_dirty ? "+dirty" : "";
  const reached = input.source.remoteUrl
    ? `remote profile '${input.source.profileName ?? "?"}'`
    : "local discovery";

  const lines: string[] = [];
  lines.push(`hub: ${hubMachine}  ${status.base_url}`);
  lines.push(
    `  reached via ${reached} · api v${status.provenance.api_version} (git ${sha}${dirty}) · ` +
      `token ${status.token_required ? "required" : "open"} · up since ${status.started_at}`,
  );
  lines.push(`  peers ${status.counts.peers} · groups ${status.counts.groups} · events ${status.counts.events}`);
  if (input.localApiVersion !== status.provenance.api_version) {
    lines.push(`  ⚠ client api v${input.localApiVersion} ≠ hub api v${status.provenance.api_version} — upgrade the lagging side`);
  }

  // Roster grouped by machine_id; the hub's own machine is marked.
  const byMachine = new Map<string, Peer[]>();
  for (const peer of peers) {
    const key = peer.machine_id ?? "(unknown)";
    (byMachine.get(key) ?? byMachine.set(key, []).get(key)!).push(peer);
  }
  lines.push("");
  if (byMachine.size === 0) {
    lines.push("roster: (no peers registered)");
    return lines;
  }
  lines.push(`roster (${peers.length} peer${peers.length === 1 ? "" : "s"} across ${byMachine.size} machine${byMachine.size === 1 ? "" : "s"}):`);
  for (const machine of [...byMachine.keys()].sort()) {
    const here = machine === hubMachine ? " (hub)" : "";
    lines.push(`  ▸ ${machine}${here}`);
    for (const peer of byMachine.get(machine)!.sort((a, b) => a.session_name.localeCompare(b.session_name))) {
      const glyph = PRESENCE_GLYPH[peer.presence ?? "online"] ?? "?";
      lines.push(`      ${glyph} ${peer.session_name}  [${peer.tool}]  ${peer.presence ?? "online"}`);
    }
  }
  return lines;
}

export interface DoctorInput {
  profileName: string | null;
  remoteUrl: string | null;
  /** null when no remote target is configured (purely local). */
  reachable: boolean | null;
  /** null when not applicable (no token / local). */
  authOk: boolean | null;
  hubApiVersion: number | null;
  localApiVersion: number;
}

export interface DoctorCheck {
  status: "ok" | "warn" | "fail";
  label: string;
  detail?: string;
}

/** Evaluate readiness checks from already-fetched facts (pure). */
export function evaluateDoctor(input: DoctorInput): DoctorCheck[] {
  const checks: DoctorCheck[] = [];

  if (!input.remoteUrl) {
    checks.push({ status: "ok", label: "mode", detail: "local daemon (no remote profile active)" });
    return checks;
  }

  checks.push({ status: "ok", label: "active profile", detail: `${input.profileName ?? "?"} → ${input.remoteUrl}` });
  checks.push(
    input.reachable
      ? { status: "ok", label: "hub reachable", detail: input.remoteUrl }
      : { status: "fail", label: "hub reachable", detail: `cannot reach ${input.remoteUrl} (tailnet down? wrong port?)` },
  );

  if (input.reachable) {
    if (input.authOk === false) {
      checks.push({ status: "fail", label: "auth", detail: "401 — set/check SYNCHRONIZE_TOKEN for this profile" });
    } else if (input.authOk === true) {
      checks.push({ status: "ok", label: "auth", detail: "bearer token accepted" });
    }
    if (input.hubApiVersion !== null) {
      checks.push(
        input.hubApiVersion === input.localApiVersion
          ? { status: "ok", label: "api version", detail: `v${input.hubApiVersion} (matches client)` }
          : { status: "warn", label: "api version", detail: `hub v${input.hubApiVersion} ≠ client v${input.localApiVersion} — upgrade the lagging side` },
      );
    }
  }
  return checks;
}

export function renderDoctor(checks: DoctorCheck[]): string[] {
  const glyph = { ok: "✓", warn: "⚠", fail: "✗" } as const;
  return checks.map((c) => `${glyph[c.status]} ${c.label}${c.detail ? `: ${c.detail}` : ""}`);
}
