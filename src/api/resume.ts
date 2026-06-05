import { requestJson, type ClientConfig } from "../client.ts";

export interface ResumeSessionResult {
  mode: "launch" | "print";
  peer_id: string;
  tool: string;
  cwd: string;
  host_session_id: string;
  forced: boolean;
  command?: string[];
  env?: Record<string, string>;
  launch?: unknown;
}

export interface GroupResumeMemberResult {
  alias: string | null;
  tool: string;
  peer_id: string;
  action: "launching" | "printed" | "skipped" | "blocked";
  warning?: string;
}

export interface ResumeGroupResult {
  group: string;
  mode: "launch" | "print";
  members: GroupResumeMemberResult[];
}

export function resumeSession(
  client: ClientConfig,
  input: { peerId?: string; sessionId?: string; print?: boolean; force?: boolean },
): Promise<ResumeSessionResult> {
  return requestJson<ResumeSessionResult>(client, "/resume/session", {
    method: "POST",
    body: JSON.stringify({
      ...(input.peerId ? { peer_id: input.peerId } : {}),
      ...(input.sessionId ? { session_id: input.sessionId } : {}),
      ...(input.print ? { print: true } : {}),
      ...(input.force ? { force: true } : {}),
    }),
  });
}

export function resumeGroup(
  client: ClientConfig,
  input: { group: string; print?: boolean; force?: boolean; only?: string[]; exclude?: string[] },
): Promise<ResumeGroupResult> {
  return requestJson<ResumeGroupResult>(client, "/resume/group", {
    method: "POST",
    body: JSON.stringify({
      group: input.group,
      ...(input.print ? { print: true } : {}),
      ...(input.force ? { force: true } : {}),
      ...(input.only ? { only: input.only } : {}),
      ...(input.exclude ? { exclude: input.exclude } : {}),
    }),
  });
}
