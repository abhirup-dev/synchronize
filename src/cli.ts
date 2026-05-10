#!/usr/bin/env bun
import { ensureDaemon } from "./client.ts";
import {
  ackInbox,
  createGroup,
  findReusablePeer,
  getGroupHistory,
  getMedia,
  getStatus,
  getSummary,
  joinGroup,
  leaveGroup,
  listMedia,
  listPeers,
  readInbox,
  registerPeer,
  sendDm,
  sendGroupMessage,
  shareMedia,
  type SummaryResponse,
} from "./api.ts";
import { readJson, writeJson } from "./fs.ts";

interface CliIdentity {
  peer_id: string;
  session_name: string;
}

function printHelp(): void {
  console.log(`synchronize

Usage:
  synchronize status
  synchronize top [--once] [--json] [--interval SECONDS]
  synchronize register --name NAME [--purpose TEXT]
  synchronize whoami
  synchronize peers
  synchronize dm PEER MESSAGE
  synchronize inbox [--ack]
  synchronize group create NAME --as SESSION_NAME [--ephemeral]
  synchronize group join NAME --as SESSION_NAME [--alias ALIAS] [--fresh]
  synchronize group leave NAME --as SESSION_NAME
  synchronize group send NAME --as SESSION_NAME MESSAGE
  synchronize group history NAME --as SESSION_NAME
  synchronize media share GROUP FILE --description TEXT
  synchronize media list GROUP [--query TEXT]
  synchronize media get MEDIA_ID
  synchronize --help

Commands:
  status    Start or connect to the local daemon and print health/status
  top       Live htop-style dashboard for daemon, peers, groups, inbox, and media
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

function printCliRealtimeWarning(): void {
  console.error(
    [
      "synchronize CLI fallback warning:",
      "  Claude channel real-time notifications do not work through CLI peers.",
      "  CLI peers do not attach a Claude channel subscription, so auto-prompt messages will not appear.",
      "  Use MCP bridge_register/bridge_dm for real-time Claude channel delivery; with CLI, use inbox polling/checking.",
    ].join("\n"),
  );
}

async function main(argv: string[]): Promise<void> {
  const [command] = argv;
  if (!command || command === "--help" || command === "-h" || command === "help") {
    printHelp();
    return;
  }

  if (command === "status") {
    const client = await ensureDaemon();
    const status = await getStatus(client);
    console.log(JSON.stringify({ ...status, daemon_started_by_cli: client.started }, null, 2));
    return;
  }

  if (command === "top" || command === "summary") {
    await handleTop(argv.slice(1));
    return;
  }

  if (command === "register") {
    const args = parseFlags(argv.slice(1));
    const name = args.flags.name;
    if (!name) throw new Error("register requires --name NAME");
    const client = await ensureDaemon();
    const peerId = await resolveCliRegisterPeerId(client, name);
    const response = await registerPeer(client, {
      sessionName: name,
      tool: "cli",
      ...(peerId ? { peerId } : {}),
      ...(args.flags.purpose ? { purpose: args.flags.purpose } : {}),
    });
    await writeIdentity(client, {
      peer_id: response.peer.peer_id,
      session_name: response.peer.session_name,
    });
    printCliRealtimeWarning();
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
    const response = await listPeers(client, args.flags.group ? { group: args.flags.group } : {});
    console.log(JSON.stringify(response.peers, null, 2));
    return;
  }

  if (command === "dm") {
    const [, recipient, ...messageParts] = argv;
    const message = messageParts.join(" ").trim();
    if (!recipient || !message) throw new Error("dm requires PEER MESSAGE");
    const client = await ensureDaemon();
    const identity = await requireIdentity(client);
    const response = await sendDm(client, {
      senderPeerId: identity.peer_id,
      recipientPeerId: recipient,
      message,
    });
    printCliRealtimeWarning();
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
    const response = await readInbox(client, identity.peer_id);
    if (args.boolFlags.has("ack") && response.events.length > 0) {
      await ackInbox(client, identity.peer_id, response.events.map((event) => event.event_id));
    }
    console.log(JSON.stringify(response, null, 2));
    return;
  }

  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exit(2);
}

async function handleTop(argv: string[]): Promise<void> {
  const args = parseFlags(argv);
  const client = await ensureDaemon();
  const intervalSeconds = args.flags.interval ? Number.parseFloat(args.flags.interval) : 1;
  if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) {
    throw new Error("--interval must be a positive number of seconds");
  }

  if (args.boolFlags.has("json")) {
    const summary = await getSummary(client);
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  if (args.boolFlags.has("once") || !process.stdout.isTTY) {
    const summary = await getSummary(client);
    console.log(renderSummary(summary));
    return;
  }

  let stopped = false;
  const stop = () => {
    stopped = true;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  process.stdout.write("\x1b[?25l");
  try {
    while (!stopped) {
      const summary = await getSummary(client);
      process.stdout.write("\x1b[H\x1b[2J");
      process.stdout.write(renderSummary(summary));
      process.stdout.write("\n\nPress Ctrl-C to quit.");
      await Bun.sleep(intervalSeconds * 1000);
    }
  } finally {
    process.stdout.write("\x1b[?25h\n");
  }
}

export function renderSummary(summary: SummaryResponse): string {
  const uptime = formatDuration(Date.now() - new Date(summary.daemon.started_at).getTime());
  const lines: string[] = [];
  lines.push(
    `synchronize top   daemon: ${summary.ok ? "ok" : "down"}   uptime: ${uptime}   pid: ${summary.daemon.pid}   ${summary.daemon.base_url}`,
  );
  lines.push(
    `PEERS ${summary.totals.peers.online} online / ${summary.totals.peers.total} total   GROUPS ${summary.totals.groups.durable} durable / ${summary.totals.groups.ephemeral} ephemeral   EVENTS ${summary.totals.events.total}   INBOX ${summary.totals.inbox.pending} pending   MEDIA ${summary.totals.media.files} files / ${formatBytes(summary.totals.media.bytes)}`,
  );
  lines.push(`DB ${summary.daemon.db_path}`);
  lines.push("");
  lines.push("Peers");
  lines.push(
    table(
      ["status", "name", "tool", "purpose", "inbox", "groups", "updated"],
      summary.peers.map((peer) => [
        peer.online ? "online" : "stale",
        peer.session_name,
        peer.tool,
        peer.purpose ?? "",
        String(peer.pending_inbox),
        String(peer.groups),
        formatRelative(peer.updated_at),
      ]),
    ),
  );
  lines.push("");
  lines.push("Groups");
  lines.push(
    table(
      ["name", "members", "messages", "media", "kind", "last activity"],
      summary.groups.map((group) => [
        group.name,
        `${group.online_members}/${group.members}`,
        String(group.messages),
        String(group.media),
        group.durable ? "durable" : "ephemeral",
        group.last_activity_at ? formatRelative(group.last_activity_at) : "never",
      ]),
    ),
  );
  lines.push("");
  lines.push(`generated: ${summary.generated_at}`);
  return lines.join("\n");
}

function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, index) => {
    const maxCell = Math.max(header.length, ...rows.map((row) => (row[index] ?? "").length));
    return Math.min(Math.max(maxCell, 4), index === 3 ? 28 : 22);
  });
  const renderRow = (row: string[]) => row.map((cell, index) => fit(cell, widths[index] ?? 12)).join("  ");
  const divider = widths.map((width) => "-".repeat(width)).join("  ");
  const body = rows.length > 0 ? rows.map(renderRow) : ["(none)"];
  return [renderRow(headers), divider, ...body].join("\n");
}

function fit(value: string, width: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length > width) return `${clean.slice(0, Math.max(0, width - 1))}~`;
  return clean.padEnd(width, " ");
}

function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)}${units[unit]}`;
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0s";
  const seconds = Math.floor(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  if (hours > 0) return `${hours}h${minutes}m`;
  if (minutes > 0) return `${minutes}m${remaining}s`;
  return `${remaining}s`;
}

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "unknown";
  if (ms < 5_000) return "now";
  return `${formatDuration(ms)} ago`;
}

async function handleGroup(argv: string[]): Promise<void> {
  const [subcommand] = argv;
  if (!subcommand) throw new Error("group requires a subcommand");

  if (subcommand === "create") {
    const [name, ...rest] = argv.slice(1);
    if (!name) throw new Error("group create requires NAME");
    const args = parseFlags(rest);
    const client = await ensureDaemon();
    if (!args.flags.as) throw new Error("group create requires --as SESSION_NAME to confirm the CLI peer identity");
    const identity = await requireIdentity(client, args.flags.as);
    const response = await createGroup(client, {
      name,
      ephemeral: args.boolFlags.has("ephemeral"),
      creatorPeerId: identity.peer_id,
    });
    console.log(JSON.stringify(response.group, null, 2));
    return;
  }

  if (subcommand === "join") {
    const [name, ...rest] = argv.slice(1);
    if (!name) throw new Error("group join requires NAME");
    const args = parseFlags(rest);
    const alias = args.flags.alias;
    if (!args.flags.as) throw new Error("group join requires --as SESSION_NAME to confirm the CLI peer identity");
    const client = await ensureDaemon();
    const identity = await requireIdentity(client, args.flags.as);
    const response = await joinGroup(client, {
      name,
      peerId: identity.peer_id,
      fresh: args.boolFlags.has("fresh"),
      ...(alias ? { alias } : {}),
    });
    console.log(JSON.stringify(response, null, 2));
    return;
  }

  if (subcommand === "leave") {
    const [name, ...rest] = argv.slice(1);
    if (!name) throw new Error("group leave requires NAME");
    const args = parseFlags(rest);
    if (!args.flags.as) throw new Error("group leave requires --as SESSION_NAME to confirm the CLI peer identity");
    const client = await ensureDaemon();
    const identity = await requireIdentity(client, args.flags.as);
    const response = await leaveGroup(client, { name, peerId: identity.peer_id });
    console.log(JSON.stringify(response, null, 2));
    return;
  }

  if (subcommand === "send") {
    const [name, ...messageParts] = argv.slice(1);
    const args = parseFlags(messageParts);
    if (!args.flags.as) throw new Error("group send requires --as SESSION_NAME to confirm the CLI peer identity");
    const message = args.rest.join(" ").trim();
    if (!name || !message) throw new Error("group send requires NAME MESSAGE");
    const client = await ensureDaemon();
    const identity = await requireIdentity(client, args.flags.as);
    const response = await sendGroupMessage(client, { name, senderPeerId: identity.peer_id, message });
    printCliRealtimeWarning();
    console.log(JSON.stringify(response.event, null, 2));
    return;
  }

  if (subcommand === "history") {
    const [name, ...rest] = argv.slice(1);
    if (!name) throw new Error("group history requires NAME");
    const args = parseFlags(rest);
    if (!args.flags.as) throw new Error("group history requires --as SESSION_NAME to confirm the CLI peer identity");
    const client = await ensureDaemon();
    const identity = await requireIdentity(client, args.flags.as);
    const response = await getGroupHistory(client, { name, peerId: identity.peer_id });
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
    const response = await shareMedia(client, {
      group,
      sharedByPeerId: identity.peer_id,
      path: file,
      ...(args.flags.description ? { description: args.flags.description } : {}),
    });
    printCliRealtimeWarning();
    console.log(JSON.stringify(response, null, 2));
    return;
  }

  if (subcommand === "list") {
    const [group, ...rest] = argv.slice(1);
    if (!group) throw new Error("media list requires GROUP");
    const args = parseFlags(rest);
    const client = await ensureDaemon();
    const response = await listMedia(client, { group, ...(args.flags.query ? { query: args.flags.query } : {}) });
    console.log(JSON.stringify(response, null, 2));
    return;
  }

  if (subcommand === "get") {
    const [mediaId] = argv.slice(1);
    if (!mediaId) throw new Error("media get requires MEDIA_ID");
    const client = await ensureDaemon();
    const response = await getMedia(client, mediaId);
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

async function resolveCliRegisterPeerId(
  client: Awaited<ReturnType<typeof ensureDaemon>>,
  sessionName: string,
): Promise<string | undefined> {
  const identity = await readJson<CliIdentity>(client.paths.cliIdentityPath);
  if (identity?.peer_id && identity.session_name === sessionName) return identity.peer_id;
  return findReusablePeer(client, { sessionName, tool: "cli" });
}

async function requireIdentity(
  client: Awaited<ReturnType<typeof ensureDaemon>>,
  expectedSessionName?: string,
): Promise<CliIdentity> {
  const identity = await readJson<CliIdentity>(client.paths.cliIdentityPath);
  if (!identity?.peer_id) {
    throw new Error("No CLI peer is registered. Run: synchronize register --name NAME");
  }
  if (expectedSessionName && identity.session_name !== expectedSessionName) {
    throw new Error(
      `CLI peer mismatch: expected session '${expectedSessionName}' but current CLI peer is '${identity.session_name}'. ` +
        `Run 'synchronize register --name ${expectedSessionName}' or use the matching --as value.`,
    );
  }
  return identity;
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
