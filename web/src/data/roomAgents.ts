import type { Agent, Room } from "./types.ts";

export function roomAgent(agent: Agent, room: Room): Agent {
  const alias = room.kind === "group" ? room.memberAliases?.[agent.id] : undefined;
  if (!alias || agent.handle === alias) return agent;
  return {
    ...agent,
    name: alias,
    handle: alias,
    statusNote: agent.name,
    avatar: (alias.trim()[0] ?? agent.avatar).toUpperCase(),
  };
}

export function roomAgents(agents: Agent[], room: Room): Agent[] {
  if (room.kind !== "group" || !room.memberAliases) return agents;
  return agents.map((agent) => roomAgent(agent, room));
}
