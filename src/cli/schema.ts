export type DynamicCompletionProvider =
  | "group-names"
  | "peer-ids"
  | "session-names"
  | "media-ids"
  | "thread-root-event-ids";

export type CliValueSpec =
  | { kind: "enum"; values: string[] }
  | { kind: "file" }
  | { kind: "directory" }
  | { kind: "dynamic"; provider: DynamicCompletionProvider };

export interface CliFlagSpec {
  name: string;
  description: string;
  value?: CliValueSpec;
  boolean?: boolean;
  repeatable?: boolean;
  required?: boolean;
}

export interface CliPositionalSpec {
  name: string;
  description: string;
  value?: CliValueSpec;
  required?: boolean;
  variadic?: boolean;
}

export interface CliPassthroughSpec {
  marker: "--";
  description: string;
}

export interface CliCommandSpec {
  name: string;
  aliases?: string[];
  description: string;
  usage?: string[];
  flags?: CliFlagSpec[];
  positionals?: CliPositionalSpec[];
  subcommands?: CliCommandSpec[];
  passthrough?: CliPassthroughSpec;
}

export interface CliSchema {
  name: string;
  description: string;
  usage: string[];
  commands: CliCommandSpec[];
  environment: Array<{ name: string; description: string }>;
}

const sessionNameValue: CliValueSpec = { kind: "dynamic", provider: "session-names" };
const groupNameValue: CliValueSpec = { kind: "dynamic", provider: "group-names" };
const peerIdValue: CliValueSpec = { kind: "dynamic", provider: "peer-ids" };
const mediaIdValue: CliValueSpec = { kind: "dynamic", provider: "media-ids" };
const threadRootEventIdValue: CliValueSpec = { kind: "dynamic", provider: "thread-root-event-ids" };

export const cliSchema: CliSchema = {
  name: "synchronize",
  description: "local-first messaging bus for agent sessions",
  usage: [
    "synchronize status",
    "synchronize top [--once] [--json] [--interval SECONDS]",
    "synchronize register --name NAME [--purpose TEXT]",
    "synchronize whoami",
    "synchronize peers",
    "synchronize dm PEER MESSAGE",
    "synchronize inbox [--ack]",
    "synchronize group create NAME --as SESSION_NAME [--ephemeral] [--description TEXT]",
    "synchronize group describe NAME DESCRIPTION | --clear",
    "synchronize group join NAME --as SESSION_NAME [--alias ALIAS] [--fresh]",
    "synchronize group leave NAME --as SESSION_NAME",
    "synchronize group rename NAME NEW_ALIAS --as SESSION_NAME",
    "synchronize group send NAME --as SESSION_NAME [--in-reply-to EVENT_ID] MESSAGE",
    "synchronize group history NAME --as SESSION_NAME [--thread-of EVENT_ID]",
    "synchronize media share GROUP FILE --description TEXT",
    "synchronize media list GROUP [--query TEXT]",
    "synchronize media get MEDIA_ID",
    "synchronize threads list [--group NAME] [--limit N]",
    "synchronize threads status ROOT_EVENT_ID",
    "synchronize threads show ROOT_EVENT_ID [--format events|transcript|status|summary]",
    "synchronize threads summary ROOT_EVENT_ID [--refresh] [--strategy all|first_k|last_k|first_last] [--k N] [--first-k N] [--last-k N] [--format text|json]",
    "synchronize query [--format json|table|csv] [--params JSON] SQL",
    "synchronize hook claude-session",
    "synchronize launch [--name NAME] [--] claude [--] [CLAUDE_ARGS...]",
    "synchronize spawn claude|pi --name NAME --repo PATH [--group GROUP] [--model MODEL] [--thinking LEVEL] [-- TOOL_ARGS...]",
    "synchronize --help",
  ],
  commands: [
    {
      name: "status",
      description: "Start or connect to the local daemon and print health/status",
    },
    {
      name: "top",
      aliases: ["summary"],
      description: "Live htop-style dashboard for daemon, peers, groups, inbox, and media",
      flags: [
        { name: "once", description: "Render one summary and exit", boolean: true },
        { name: "json", description: "Print the summary as JSON", boolean: true },
        { name: "interval", description: "Refresh interval in seconds", value: { kind: "enum", values: ["1", "2", "5"] } },
      ],
    },
    {
      name: "register",
      description: "Register this CLI session and remember its peer id",
      flags: [
        { name: "name", description: "Session name to register", value: sessionNameValue, required: true },
        { name: "purpose", description: "Human-readable session purpose" },
      ],
    },
    {
      name: "whoami",
      description: "Show the registered CLI peer identity",
    },
    {
      name: "peers",
      description: "List registered peers",
      flags: [{ name: "group", description: "Filter peers by group", value: groupNameValue }],
    },
    {
      name: "dm",
      description: "Send a durable direct message from the registered CLI peer",
      positionals: [
        { name: "PEER", description: "Recipient peer id", value: peerIdValue, required: true },
        { name: "MESSAGE", description: "Message body", required: true, variadic: true },
      ],
    },
    {
      name: "inbox",
      description: "Read the registered CLI peer inbox; --ack acknowledges returned rows",
      flags: [{ name: "ack", description: "Acknowledge returned inbox rows", boolean: true }],
    },
    {
      name: "group",
      description: "Create, join, leave, send to, and read group history",
      subcommands: [
        {
          name: "create",
          description: "Create a group",
          positionals: [{ name: "NAME", description: "Group name", required: true }],
          flags: [
            { name: "as", description: "Session name confirming the CLI peer identity", value: sessionNameValue, required: true },
            { name: "ephemeral", description: "Drop the group on daemon restart", boolean: true },
            { name: "description", description: "Group description" },
          ],
        },
        {
          name: "describe",
          description: "Set or clear a group description",
          positionals: [
            { name: "NAME", description: "Group name", value: groupNameValue, required: true },
            { name: "DESCRIPTION", description: "Description text", variadic: true },
          ],
          flags: [{ name: "clear", description: "Clear the description", boolean: true }],
        },
        {
          name: "join",
          description: "Join a group as the registered CLI peer",
          positionals: [{ name: "NAME", description: "Group name", value: groupNameValue, required: true }],
          flags: [
            { name: "as", description: "Session name confirming the CLI peer identity", value: sessionNameValue, required: true },
            { name: "alias", description: "Alias to use inside the group" },
            { name: "fresh", description: "Force a fresh join event", boolean: true },
          ],
        },
        {
          name: "leave",
          description: "Leave a group",
          positionals: [{ name: "NAME", description: "Group name", value: groupNameValue, required: true }],
          flags: [{ name: "as", description: "Session name confirming the CLI peer identity", value: sessionNameValue, required: true }],
        },
        {
          name: "rename",
          description: "Rename the CLI peer's group alias",
          positionals: [
            { name: "NAME", description: "Group name", value: groupNameValue, required: true },
            { name: "NEW_ALIAS", description: "New alias", required: true },
          ],
          flags: [{ name: "as", description: "Session name confirming the CLI peer identity", value: sessionNameValue, required: true }],
        },
        {
          name: "send",
          description: "Send a group message",
          positionals: [
            { name: "NAME", description: "Group name", value: groupNameValue, required: true },
            { name: "MESSAGE", description: "Message body", required: true, variadic: true },
          ],
          flags: [
            { name: "as", description: "Session name confirming the CLI peer identity", value: sessionNameValue, required: true },
            { name: "in-reply-to", description: "Reply target event id", value: threadRootEventIdValue },
          ],
        },
        {
          name: "history",
          description: "Read group history",
          positionals: [{ name: "NAME", description: "Group name", value: groupNameValue, required: true }],
          flags: [
            { name: "as", description: "Session name confirming the CLI peer identity", value: sessionNameValue, required: true },
            { name: "thread-of", description: "Render one thread rooted at the event id", value: threadRootEventIdValue },
          ],
        },
      ],
    },
    {
      name: "media",
      description: "Share, list, and inspect group media",
      subcommands: [
        {
          name: "share",
          description: "Share a file with a group",
          positionals: [
            { name: "GROUP", description: "Group name", value: groupNameValue, required: true },
            { name: "FILE", description: "File to share", value: { kind: "file" }, required: true },
          ],
          flags: [{ name: "description", description: "Media description" }],
        },
        {
          name: "list",
          description: "List media shared with a group",
          positionals: [{ name: "GROUP", description: "Group name", value: groupNameValue, required: true }],
          flags: [{ name: "query", description: "Filter media by text" }],
        },
        {
          name: "get",
          description: "Inspect a media item",
          positionals: [{ name: "MEDIA_ID", description: "Media id", value: mediaIdValue, required: true }],
        },
      ],
    },
    {
      name: "threads",
      description: "Discover, summarize, and render deeper group conversations",
      subcommands: [
        {
          name: "list",
          description: "List discovered threads",
          flags: [
            { name: "group", description: "Filter by group", value: groupNameValue },
            { name: "limit", description: "Maximum number of threads" },
            { name: "started-by-peer-id", description: "Filter by starter peer id", value: peerIdValue },
            { name: "started-by-session-name", description: "Filter by starter session name", value: sessionNameValue },
            { name: "participated-by-peer-id", description: "Filter by participant peer id", value: peerIdValue },
            { name: "participated-by-session-name", description: "Filter by participant session name", value: sessionNameValue },
            { name: "active-since", description: "Filter by last activity timestamp" },
          ],
        },
        {
          name: "status",
          description: "Show thread summary status",
          positionals: [{ name: "ROOT_EVENT_ID", description: "Thread root event id", value: threadRootEventIdValue, required: true }],
        },
        {
          name: "show",
          description: "Render one thread",
          positionals: [{ name: "ROOT_EVENT_ID", description: "Thread root event id", value: threadRootEventIdValue, required: true }],
          flags: [{ name: "format", description: "Output format", value: { kind: "enum", values: ["events", "transcript", "status", "summary"] } }],
        },
        {
          name: "summary",
          description: "Read or refresh a thread summary",
          positionals: [{ name: "ROOT_EVENT_ID", description: "Thread root event id", value: threadRootEventIdValue, required: true }],
          flags: [
            { name: "refresh", description: "Regenerate the summary", boolean: true },
            { name: "strategy", description: "Selection strategy", value: { kind: "enum", values: ["all", "first_k", "last_k", "first_last"] } },
            { name: "k", description: "Generic selection count" },
            { name: "first-k", description: "First events count" },
            { name: "last-k", description: "Last events count" },
            { name: "format", description: "Output format", value: { kind: "enum", values: ["text", "json"] } },
          ],
        },
      ],
    },
    {
      name: "query",
      description: "Run guarded read-only SQL against daemon event state",
      flags: [
        { name: "format", description: "Output format", value: { kind: "enum", values: ["json", "table", "csv"] } },
        { name: "params", description: "JSON array of SQL parameters" },
        { name: "limit", description: "Maximum row count" },
      ],
      positionals: [{ name: "SQL", description: "Read-only SQL query", required: true, variadic: true }],
    },
    {
      name: "hook",
      description: "Internal host-agent hook ingestion commands",
      subcommands: [{ name: "claude-session", description: "Ingest a Claude session hook payload" }],
    },
    {
      name: "launch",
      description: "Start an agent in the foreground with synchronize daemon/env setup",
      flags: [{ name: "name", description: "Session name", value: sessionNameValue }],
      positionals: [{ name: "target", description: "Agent runtime", value: { kind: "enum", values: ["claude", "pi"] }, required: true }],
      passthrough: { marker: "--", description: "Arguments passed to the launched agent" },
    },
    {
      name: "spawn",
      description: "Launch a persistent agent session via the backend (AOE), optionally into a group",
      positionals: [{ name: "tool", description: "Agent runtime", value: { kind: "enum", values: ["claude", "pi"] }, required: true }],
      flags: [
        { name: "name", description: "Session name", value: sessionNameValue, required: true },
        { name: "repo", description: "Repository path", value: { kind: "directory" }, required: true },
        { name: "group", description: "Group to join", value: groupNameValue },
        { name: "model", description: "Agent model" },
        { name: "thinking", description: "Thinking level" },
      ],
      passthrough: { marker: "--", description: "Arguments passed to the spawned tool" },
    },
  ],
  environment: [
    { name: "SYNCHRONIZE_HOME", description: "Runtime directory (default: ~/.synchronize)" },
    { name: "SYNCHRONIZE_BIND", description: "Daemon bind host (default: 127.0.0.1)" },
    { name: "SYNCHRONIZE_PORT", description: "Daemon port (default: 0, random free port)" },
    { name: "SYNCHRONIZE_TOKEN", description: "Bearer token; required for non-localhost bind" },
  ],
};

export function topLevelCommandNames(schema: CliSchema = cliSchema): string[] {
  return schema.commands.flatMap((command) => [command.name, ...(command.aliases ?? [])]);
}
