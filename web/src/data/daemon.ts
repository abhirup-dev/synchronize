// DaemonDataSource — REST + polling against the live synchronize daemon.
//
// V0 scope: stub. The interface is in place so components can compile against
// either adapter; the real implementation (peer registration, inbox polling,
// SSE upgrade) is tracked under `sync-jix` follow-up beads. Until then,
// constructing this throws so we don't silently fall through.

import type {
  Agent,
  Artifact,
  DataSource,
  Message,
  Room,
  SendMessageInput,
  Snapshot,
  Task,
  TimelineEvent,
} from "./types.ts";

export interface DaemonDataSourceOptions {
  baseUrl: string;
  token?: string;
}

export class DaemonDataSource implements DataSource {
  readonly kind = "daemon" as const;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_opts: DaemonDataSourceOptions) {
    throw new Error(
      "DaemonDataSource is not implemented yet — see sync-jix follow-up beads.",
    );
  }

  agents(): Snapshot<Agent[]> { throw new Error("not implemented"); }
  rooms(): Snapshot<Room[]>   { throw new Error("not implemented"); }
  me(): Snapshot<Agent>        { throw new Error("not implemented"); }
  messages(_id: string): Snapshot<Message[]> { throw new Error("not implemented"); }
  threadReplies(_id: string): Snapshot<Message[]> { throw new Error("not implemented"); }
  timeline(_id: string): Snapshot<TimelineEvent[]> { throw new Error("not implemented"); }
  tasks(_id: string): Snapshot<Task[]> { throw new Error("not implemented"); }
  artifacts(_id: string): Snapshot<Artifact[]> { throw new Error("not implemented"); }
  sendMessage(_input: SendMessageInput): Promise<Message> { throw new Error("not implemented"); }
  setAgentColor(_id: string, _hex: string | null): void { throw new Error("not implemented"); }
  async connect(): Promise<void> { throw new Error("not implemented"); }
  disconnect(): void { /* noop */ }
}
