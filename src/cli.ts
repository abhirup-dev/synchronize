#!/usr/bin/env bun
import { ensureDaemon, requestJson } from "./client.ts";
import { readJson, writeJson } from "./fs.ts";

interface StatusResponse {
  ok: boolean;
  pid: number;
  base_url: string;
  started_at: string;
  token_required: boolean;
  home: string;
  db_path: string;
  media_path: string;
  counts: {
    peers: number;
    groups: number;
    events: number;
  };
}

interface Peer {
  peer_id: string;
  tool: string;
  session_name: string;
  purpose: string | null;
  lease_expires_at: string;
  online?: boolean;
}

interface Event {
  event_id: number;
  type: string;
  sender_peer_id: string | null;
  recipient_peer_id: string | null;
  group_id?: number | null;
  body: string | null;
  created_at: string;
  acked_at?: string | null;
}

interface Group {
  group_id: number;
  name: string;
  durable: boolean;
  media_dir: string;
  creator_peer_id: string | null;
  created_at: string;
}

interface CliIdentity {
  peer_id: string;
  session_name: string;
}

function printHelp(): void {
  console.log(`synchronize

Usage:
  synchronize status
  synchronize register --name NAME [--purpose TEXT]
  synchronize whoami
  synchronize peers
  synchronize dm PEER MESSAGE
  synchronize inbox [--ack]
  synchronize group create NAME [--ephemeral]
  synchronize group join NAME [--alias ALIAS] [--fresh]
  synchronize group leave NAME
  synchronize group send NAME MESSAGE
  synchronize group history NAME
  synchronize media share GROUP FILE --description TEXT
  synchronize media list GROUP [--query TEXT]
  synchronize media get MEDIA_ID
  synchronize --help

Commands:
  status    Start or connect to the local daemon and print health/status
  register  Register this CLI session and remember its peer id
  whoami    Show the registered CLI peer identity
  peers     List registered peers
  dm        Send a durable direct message from the registered CLI peer
  inbox     Read the registered CLI peer inbox; --ack acknowledges returned rows
  group     Create, join, leave, send to, and read group history
  media     Share, list, and inspect group media

Environment:
  SYNCHRONIZE_HOME    Runtime directory (default: ~/.synchronize)
  SYNCHRONIZE_BIND    Daemon bind host (default: 127.0.0.1)
  SYNCHRONIZE_PORT    Daemon port (default: 0, random free port)
  SYNCHRONIZE_TOKEN   Bearer token; required for non-localhost bind
`);
}

async function main(argv: string[]): Promise<void> {
  const [command] = argv;
  if (!command || command === "--help" || command === "-h" || command === "help") {
    printHelp();
    return;
  }

  if (command === "status") {
    const client = await ensureDaemon();
    const status = await requestJson<StatusResponse>(client, "/status");
    console.log(JSON.stringify({ ...status, daemon_started_by_cli: client.started }, null, 2));
    return;
  }

  if (command === "register") {
    const args = parseFlags(argv.slice(1));
    const name = args.flags.name;
    if (!name) throw new Error("register requires --name NAME");
    const client = await ensureDaemon();
    const response = await requestJson<{ peer: Peer }>(client, "/peers/register", {
      method: "POST",
      body: JSON.stringify({
        session_name: name,
        purpose: args.flags.purpose,
        tool: "cli",
      }),
    });
    await writeIdentity(client, {
      peer_id: response.peer.peer_id,
      session_name: response.peer.session_name,
    });
    console.log(JSON.stringify(response.peer, null, 2));
    return;
  }

  if (command === "whoami") {
    const client = await ensureDaemon();
    const identity = await requireIdentity(client);
    console.log(JSON.stringify(identity, null, 2));
    return;
  }

  if (command === "peers") {
    const args = parseFlags(argv.slice(1));
    const client = await ensureDaemon();
    const path = args.flags.group ? `/peers?group=${encodeURIComponent(args.flags.group)}` : "/peers";
    const response = await requestJson<{ peers: Peer[] }>(client, path);
    console.log(JSON.stringify(response.peers, null, 2));
    return;
  }

  if (command === "dm") {
    const [, recipient, ...messageParts] = argv;
    const message = messageParts.join(" ").trim();
    if (!recipient || !message) throw new Error("dm requires PEER MESSAGE");
    const client = await ensureDaemon();
    const identity = await requireIdentity(client);
    const response = await requestJson<{ event: Event }>(client, "/dm", {
      method: "POST",
      body: JSON.stringify({
        sender_peer_id: identity.peer_id,
        recipient_peer_id: recipient,
        message,
      }),
    });
    console.log(JSON.stringify(response.event, null, 2));
    return;
  }

  if (command === "group") {
    await handleGroup(argv.slice(1));
    return;
  }

  if (command === "media") {
    await handleMedia(argv.slice(1));
    return;
  }

  if (command === "inbox") {
    const args = parseFlags(argv.slice(1));
    const client = await ensureDaemon();
    const identity = await requireIdentity(client);
    const response = await requestJson<{ events: Event[]; next_cursor: number }>(
      client,
      `/peers/${encodeURIComponent(identity.peer_id)}/inbox`,
    );
    if (args.boolFlags.has("ack") && response.events.length > 0) {
      await requestJson(client, `/peers/${encodeURIComponent(identity.peer_id)}/inbox/ack`, {
        method: "POST",
        body: JSON.stringify({ event_ids: response.events.map((event) => event.event_id) }),
      });
    }
    console.log(JSON.stringify(response, null, 2));
    return;
  }

  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exit(2);
}

async function handleGroup(argv: string[]): Promise<void> {
  const [subcommand] = argv;
  if (!subcommand) throw new Error("group requires a subcommand");

  if (subcommand === "create") {
    const [name, ...rest] = argv.slice(1);
    if (!name) throw new Error("group create requires NAME");
    const args = parseFlags(rest);
    const client = await ensureDaemon();
    const identity = await readJson<CliIdentity>(client.paths.cliIdentityPath);
    const response = await requestJson<{ group: Group }>(client, "/groups", {
      method: "POST",
      body: JSON.stringify({
        name,
        ephemeral: args.boolFlags.has("ephemeral"),
        creator_peer_id: identity?.peer_id,
      }),
    });
    console.log(JSON.stringify(response.group, null, 2));
    return;
  }

  if (subcommand === "join") {
    const [name, ...rest] = argv.slice(1);
    if (!name) throw new Error("group join requires NAME");
    const args = parseFlags(rest);
    const client = await ensureDaemon();
    const identity = await requireIdentity(client);
    const response = await requestJson(client, `/groups/${encodeURIComponent(name)}/join`, {
      method: "POST",
      body: JSON.stringify({
        peer_id: identity.peer_id,
        alias: args.flags.alias,
        fresh: args.boolFlags.has("fresh"),
      }),
    });
    console.log(JSON.stringify(response, null, 2));
    return;
  }

  if (subcommand === "leave") {
    const [name] = argv.slice(1);
    if (!name) throw new Error("group leave requires NAME");
    const client = await ensureDaemon();
    const identity = await requireIdentity(client);
    const response = await requestJson(client, `/groups/${encodeURIComponent(name)}/leave`, {
      method: "POST",
      body: JSON.stringify({ peer_id: identity.peer_id }),
    });
    console.log(JSON.stringify(response, null, 2));
    return;
  }

  if (subcommand === "send") {
    const [name, ...messageParts] = argv.slice(1);
    const message = messageParts.join(" ").trim();
    if (!name || !message) throw new Error("group send requires NAME MESSAGE");
    const client = await ensureDaemon();
    const identity = await requireIdentity(client);
    const response = await requestJson<{ event: Event }>(client, `/groups/${encodeURIComponent(name)}/messages`, {
      method: "POST",
      body: JSON.stringify({ sender_peer_id: identity.peer_id, message }),
    });
    console.log(JSON.stringify(response.event, null, 2));
    return;
  }

  if (subcommand === "history") {
    const [name] = argv.slice(1);
    if (!name) throw new Error("group history requires NAME");
    const client = await ensureDaemon();
    const identity = await requireIdentity(client);
    const response = await requestJson<{ events: Event[]; next_cursor: number }>(
      client,
      `/groups/${encodeURIComponent(name)}/history?peer_id=${encodeURIComponent(identity.peer_id)}`,
    );
    console.log(JSON.stringify(response, null, 2));
    return;
  }

  throw new Error(`Unknown group subcommand: ${subcommand}`);
}

async function handleMedia(argv: string[]): Promise<void> {
  const [subcommand] = argv;
  if (!subcommand) throw new Error("media requires a subcommand");

  if (subcommand === "share") {
    const [group, file, ...rest] = argv.slice(1);
    if (!group || !file) throw new Error("media share requires GROUP FILE");
    const args = parseFlags(rest);
    const client = await ensureDaemon();
    const identity = await requireIdentity(client);
    const response = await requestJson(client, `/groups/${encodeURIComponent(group)}/media`, {
      method: "POST",
      body: JSON.stringify({
        shared_by_peer_id: identity.peer_id,
        path: file,
        description: args.flags.description,
      }),
    });
    console.log(JSON.stringify(response, null, 2));
    return;
  }

  if (subcommand === "list") {
    const [group, ...rest] = argv.slice(1);
    if (!group) throw new Error("media list requires GROUP");
    const args = parseFlags(rest);
    const client = await ensureDaemon();
    const query = args.flags.query ? `?query=${encodeURIComponent(args.flags.query)}` : "";
    const response = await requestJson(client, `/groups/${encodeURIComponent(group)}/media${query}`);
    console.log(JSON.stringify(response, null, 2));
    return;
  }

  if (subcommand === "get") {
    const [mediaId] = argv.slice(1);
    if (!mediaId) throw new Error("media get requires MEDIA_ID");
    const client = await ensureDaemon();
    const response = await requestJson(client, `/media/${encodeURIComponent(mediaId)}`);
    console.log(JSON.stringify(response, null, 2));
    return;
  }

  throw new Error(`Unknown media subcommand: ${subcommand}`);
}

function parseFlags(argv: string[]): { flags: Record<string, string>; boolFlags: Set<string>; rest: string[] } {
  const flags: Record<string, string> = {};
  const boolFlags = new Set<string>();
  const rest: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg?.startsWith("--")) {
      if (arg) rest.push(arg);
      continue;
    }
    const name = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      boolFlags.add(name);
      continue;
    }
    flags[name] = next;
    index += 1;
  }
  return { flags, boolFlags, rest };
}

async function writeIdentity(client: Awaited<ReturnType<typeof ensureDaemon>>, identity: CliIdentity): Promise<void> {
  await writeJson(client.paths.cliIdentityPath, identity);
}

async function requireIdentity(client: Awaited<ReturnType<typeof ensureDaemon>>): Promise<CliIdentity> {
  const identity = await readJson<CliIdentity>(client.paths.cliIdentityPath);
  if (!identity?.peer_id) {
    throw new Error("No CLI peer is registered. Run: synchronize register --name NAME");
  }
  return identity;
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
