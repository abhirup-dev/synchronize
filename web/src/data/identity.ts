import type { Agent } from "./types.ts";

type AgentIdentity = Pick<Agent, "id" | "role" | "handle">;
type MeIdentity = Pick<Agent, "id">;

// The single source of truth for "is this agent the local human driving this
// web client?" — i.e. "you".
//
// Historically this was decided in four scattered, drifting ways that all mean
// the same thing:
//   • id === "you"        (the mock seed's fixed id)
//   • id === me.id        (whoever the current session reports as itself)
//   • role === "web"      (the live daemon registers the web client as a peer;
//                           also seen as "web-ui" / "web-local")
//   • handle === "you"    (mention-chip self check)
// They are one identity. Centralize every check here so the avatar suppression,
// right-alignment, accent bubble, and self-mention styling can never disagree
// about who "you" is again.
export function isSelfAgent(agent: AgentIdentity, me?: MeIdentity | null): boolean {
  if (me && agent.id === me.id) return true;
  if (agent.id === "you" || agent.handle === "you") return true;
  const role = (agent.role ?? "").trim().toLowerCase();
  return role.startsWith("web");
}
