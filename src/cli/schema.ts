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
    "synchronize archive session (--peer-id PEER_ID | --session-id SESSION_ID) [--reason TEXT] [--dry-run]",
    "synchronize archive group NAME [--reason TEXT] [--dry-run]",
    "synchronize resume launch (--peer-id PEER_ID | --session-id SESSION_ID) [--force] [--print]",
    "synchronize resume group NAME [--only ALIASES] [--exclude ALIASES] [--force] [--print]",
    "synchronize media share GROUP FILE --description TEXT",
    "synchronize media list GROUP [--query TEXT]",
    "synchronize media get MEDIA_ID",
    "synchronize threads list [--group NAME] [--limit N]",
    "synchronize threads status ROOT_EVENT_ID",
    "synchronize threads show ROOT_EVENT_ID [--format events|transcript|status|summary]",
    "synchronize threads summary ROOT_EVENT_ID [--refresh] [--strategy all|first_k|last_k|first_last] [--k N] [--first-k N] [--last-k N] [--format text|json]",
    "synchronize query [--format json|table|csv] [--params JSON] SQL",
    "synchronize hook claude-session",
    "synchronize launch [--name NAME] [--] claude|pi|letta [--] [TOOL_ARGS...]",
    "synchronize spawn claude|pi|letta --name NAME [--repo PATH] [--group GROUP] [--model MODEL] [--thinking LEVEL] [-- TOOL_ARGS...]",
    "synchronize host --bind HOST --token TOKEN [--port PORT] [--home PATH] [--restart]",
    "synchronize completion carapace",
    "synchronize completion install --shell carapace",
    "synchronize remote add NAME --url URL [--token-env ENV | --token LITERAL] [--ssh-host HOST] [--use]",
    "synchronize remote use NAME | ls | show [NAME] | remove NAME",
    "synchronize remote provision HOST | sync HOST --hub-url URL | connect HOST | harness HOST --hub-url URL [--all]",
    "synchronize remote status | doctor",
    "synchronize help [COMMAND [SUBCOMMAND]]",
  ],
  commands: [
    {
      name: "help",
      description: "Show top-level or command-specific help",
      usage: ["synchronize help [COMMAND [SUBCOMMAND]]", "synchronize COMMAND --help", "synchronize COMMAND SUBCOMMAND --help"],
      positionals: [{ name: "TOPIC", description: "Command path to explain", variadic: true }],
    },
    {
      name: "status",
      description: "Start or connect to the local daemon and print health/status",
      usage: ["synchronize status"],
    },
    {
      name: "top",
      aliases: ["summary"],
      description: "Live htop-style dashboard for daemon, peers, groups, inbox, and media",
      usage: ["synchronize top [--once] [--json] [--interval SECONDS]"],
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
      name: "archive",
      description: "Archive sessions or groups while preserving durable history",
      usage: [
        "synchronize archive session --peer-id PEER_ID [--reason TEXT] [--dry-run]",
        "synchronize archive session --session-id SESSION_ID [--reason TEXT] [--dry-run]",
        "synchronize archive group NAME [--reason TEXT] [--dry-run]",
      ],
      subcommands: [
        {
          name: "session",
          description: "Archive one peer/session identity",
          usage: [
            "synchronize archive session --peer-id PEER_ID [--reason TEXT] [--dry-run]",
            "synchronize archive session --session-id SESSION_ID [--reason TEXT] [--dry-run]",
          ],
          flags: [
            { name: "peer-id", description: "Peer id to archive", value: peerIdValue },
            { name: "session-id", description: "Host session id to archive" },
            { name: "reason", description: "Archive reason" },
            { name: "dry-run", description: "Print the archive plan without mutating", boolean: true },
          ],
        },
        {
          name: "group",
          description: "Archive all launchable members of a group",
          usage: ["synchronize archive group NAME [--reason TEXT] [--dry-run]"],
          positionals: [{ name: "NAME", description: "Group name", value: groupNameValue, required: true }],
          flags: [
            { name: "reason", description: "Archive reason" },
            { name: "dry-run", description: "Print the archive plan without mutating", boolean: true },
          ],
        },
      ],
    },
    {
      name: "resume",
      description: "Resume archived sessions or groups",
      usage: [
        "synchronize resume launch --peer-id PEER_ID [--force] [--print]",
        "synchronize resume launch --session-id SESSION_ID [--force] [--print]",
        "synchronize resume show (--peer-id PEER_ID | --session-id SESSION_ID)",
        "synchronize resume group NAME [--only ALIASES] [--exclude ALIASES] [--force] [--print]",
      ],
      subcommands: [
        {
          name: "launch",
          description: "Resume one archived launch-backed session",
          usage: [
            "synchronize resume launch --peer-id PEER_ID [--force] [--print]",
            "synchronize resume launch --session-id SESSION_ID [--force] [--print]",
          ],
          flags: [
            { name: "peer-id", description: "Peer id to resume", value: peerIdValue },
            { name: "session-id", description: "Host session id to resume" },
            { name: "force", description: "Terminate a blocking live peer before resume", boolean: true },
            { name: "print", description: "Print the resume command instead of launching", boolean: true },
          ],
        },
        {
          name: "show",
          description: "Print the resume command for one archived session",
          usage: [
            "synchronize resume show --peer-id PEER_ID",
            "synchronize resume show --session-id SESSION_ID",
          ],
          flags: [
            { name: "peer-id", description: "Peer id to inspect", value: peerIdValue },
            { name: "session-id", description: "Host session id to inspect" },
          ],
        },
        {
          name: "group",
          description: "Resume archived members of a group",
          usage: ["synchronize resume group NAME [--only ALIASES] [--exclude ALIASES] [--force] [--print]"],
          positionals: [{ name: "NAME", description: "Group name", value: groupNameValue, required: true }],
          flags: [
            { name: "only", description: "Comma-separated aliases/session names to resume" },
            { name: "exclude", description: "Comma-separated aliases/session names to skip" },
            { name: "force", description: "Terminate blocking live peers before resume", boolean: true },
            { name: "print", description: "Print resume commands instead of launching", boolean: true },
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
      usage: [
        "synchronize launch [--name NAME] [--] claude [TOOL_ARGS...]",
        "synchronize launch [--name NAME] [--] pi [TOOL_ARGS...]",
        "synchronize launch [--name NAME] [--] letta [TOOL_ARGS...]",
      ],
      flags: [{ name: "name", description: "Session name", value: sessionNameValue }],
      positionals: [{ name: "target", description: "Agent runtime", value: { kind: "enum", values: ["claude", "pi", "letta"] }, required: true }],
      passthrough: { marker: "--", description: "Arguments passed to the launched agent" },
    },
    {
      name: "spawn",
      description: "Launch a persistent agent session via the backend (AOE), optionally into a group",
      usage: [
        "synchronize spawn claude --name NAME --repo PATH [--group GROUP] [--model MODEL] [--thinking LEVEL] [-- TOOL_ARGS...]",
        "synchronize spawn pi --name NAME --repo PATH [--group GROUP] [--model MODEL] [--thinking LEVEL] [-- TOOL_ARGS...]",
        "synchronize spawn letta --name NAME",
        "synchronize spawn letta --name NAME --repo PATH [-- TOOL_ARGS...]",
      ],
      positionals: [{ name: "tool", description: "Agent runtime", value: { kind: "enum", values: ["claude", "pi", "letta"] }, required: true }],
      flags: [
        { name: "name", description: "Session/configured agent name", value: sessionNameValue, required: true },
        { name: "repo", description: "Repository path; required unless NAME resolves to a configured remote agent", value: { kind: "directory" } },
        { name: "group", description: "Group to join", value: groupNameValue },
        { name: "model", description: "Agent model" },
        { name: "thinking", description: "Thinking level" },
      ],
      passthrough: { marker: "--", description: "Arguments passed to the spawned tool" },
    },
    {
      name: "host",
      description: "Start or verify a token-protected daemon for LAN/tailnet clients",
      usage: ["synchronize host --bind HOST --token TOKEN [--port PORT] [--home PATH] [--restart]"],
      flags: [
        { name: "bind", description: "Daemon bind host", required: true },
        { name: "port", description: "Daemon port" },
        { name: "token", description: "Bearer token", required: true },
        { name: "home", description: "Runtime home" },
        { name: "restart", description: "Restart an incompatible existing daemon", boolean: true },
      ],
    },
    {
      name: "completion",
      description: "Generate shell completion specs",
      usage: ["synchronize completion carapace", "synchronize completion install --shell carapace"],
      subcommands: [
        {
          name: "carapace",
          description: "Print a Carapace spec for synchronize",
        },
        {
          name: "complete",
          description: "Internal dynamic completion bridge",
          positionals: [
            {
              name: "PROVIDER",
              description: "Dynamic provider name",
              value: {
                kind: "enum",
                values: ["group-names", "peer-ids", "session-names", "media-ids", "thread-root-event-ids"],
              },
              required: true,
            },
          ],
          flags: [{ name: "context", description: "Provider context JSON" }],
        },
        {
          name: "install",
          description: "Install shell completion specs",
          flags: [
            {
              name: "shell",
              description: "Completion shell target",
              value: { kind: "enum", values: ["carapace"] },
              required: true,
            },
          ],
        },
      ],
    },
    {
      name: "remote",
      description: "Manage multi-machine profiles, provision/sync remotes, run the harness, and inspect status",
      usage: [
        "synchronize remote add NAME --url URL [--token-env ENV | --token LITERAL] [--ssh-host HOST] [--use]",
        "synchronize remote use NAME",
        "synchronize remote ls",
        "synchronize remote show [NAME]",
        "synchronize remote remove NAME",
        "synchronize remote provision HOST [--dry-run]",
        "synchronize remote sync HOST --hub-url URL [--path REMOTE_DIR] [--skip-install] [--dry-run]",
        "synchronize remote connect HOST_OR_PROFILE [--remote-port PORT] [--path REMOTE_DIR] [--letta-agent SPEC] [--restart-channel] [--dry-run]",
        "synchronize remote harness HOST --hub-url URL [--scenario NAME | --all] [-- EXTRA_ARGS...]",
        "synchronize remote status",
        "synchronize remote doctor",
      ],
      subcommands: [
        {
          name: "add",
          description: "Define a connection profile in ~/.synchronize/config.toml",
          usage: ["synchronize remote add NAME --url URL [--token-env ENV | --token LITERAL] [--ssh-host HOST] [--use]"],
          positionals: [{ name: "NAME", description: "Profile name", required: true }],
          flags: [
            { name: "url", description: "Hub daemon URL", required: true },
            { name: "token-env", description: "Env var holding the bearer token" },
            { name: "token", description: "Literal bearer token" },
            { name: "health-timeout-ms", description: "Health probe timeout (ms)" },
            { name: "ssh-host", description: "SSH host for provision/sync" },
            { name: "use", description: "Make this the active profile", boolean: true },
          ],
        },
        { name: "use", description: "Set the active profile", usage: ["synchronize remote use NAME"], positionals: [{ name: "NAME", description: "Profile name", required: true }] },
        { name: "ls", aliases: ["list"], description: "List profiles (active marked with *)", usage: ["synchronize remote ls"] },
        { name: "show", description: "Show a profile and its resolved connection", usage: ["synchronize remote show [NAME]"], positionals: [{ name: "NAME", description: "Profile name (default: active)" }] },
        { name: "remove", aliases: ["rm"], description: "Delete a profile", usage: ["synchronize remote remove NAME"], positionals: [{ name: "NAME", description: "Profile name", required: true }] },
        {
          name: "provision",
          description: "Verify remote tools + non-interactive PATH",
          usage: ["synchronize remote provision HOST [--dry-run]"],
          positionals: [{ name: "HOST", description: "SSH host", required: true }],
          flags: [{ name: "dry-run", description: "Print the plan without running it", boolean: true }],
        },
        {
          name: "sync",
          description: "rsync runtime to a remote, write its config, verify the hub",
          usage: [
            "synchronize remote sync HOST --hub-url URL [--path REMOTE_DIR] [--token TOKEN | --token-env ENV] [--skip-install] [--dry-run]",
          ],
          positionals: [{ name: "HOST", description: "SSH host", required: true }],
          flags: [
            { name: "hub-url", description: "Hub daemon URL the remote points at", required: true },
            { name: "path", description: "Remote runtime dir" },
            { name: "token", description: "Literal token for the remote config" },
            { name: "token-env", description: "Env var name for the remote config token" },
            { name: "daemon-bind", description: "Bind for the synced daemon config (default: 0.0.0.0)" },
            { name: "lease-ms", description: "Daemon lease_ms for the synced config" },
            { name: "peer-retention-ms", description: "Daemon peer_retention_ms for the synced config" },
            { name: "sweep-interval-ms", description: "Daemon sweep_interval_ms for the synced config" },
            { name: "skip-install", description: "Skip remote bun install", boolean: true },
            { name: "dry-run", description: "Print the plan without running it", boolean: true },
          ],
        },
        {
          name: "connect",
          description: "Connect an SSH remote/profile to the local daemon through an SSH reverse tunnel",
          usage: [
            "synchronize remote connect HOST_OR_PROFILE [--path REMOTE_DIR] [--remote-port PORT] [--expose ssh-reverse]",
            "synchronize remote connect HOST_OR_PROFILE --letta-agent CHAT:SESSION:AGENT[:CONVERSATION] [--letta-base-url URL] [--poll-ms MS]",
          ],
          positionals: [{ name: "HOST", description: "SSH host or [remote.<name>] profile", required: true }],
          flags: [
            { name: "path", description: "Remote runtime dir" },
            { name: "remote-port", description: "Remote localhost port exposed by the reverse tunnel" },
            { name: "expose", description: "Exposure mode", value: { kind: "enum", values: ["ssh-reverse"] } },
            { name: "letta-agent", description: "Letta route spec chatId:sessionName:agentId[:conversationId]" },
            { name: "letta-base-url", description: "Self-hosted Letta server URL on the remote" },
            { name: "letta-api-key", description: "Letta API key for the channel process" },
            { name: "poll-ms", description: "Letta channel polling interval" },
            { name: "restart-channel", description: "Restart an already-running Letta channel after provisioning", boolean: true },
            { name: "skip-install", description: "Skip remote bun install", boolean: true },
            { name: "skip-provision", description: "Skip remote tool verification", boolean: true },
            { name: "dry-run", description: "Print the plan without running it", boolean: true },
          ],
        },
        {
          name: "harness",
          description: "Run the Python AOE harness on a remote against the hub",
          usage: [
            "synchronize remote harness HOST --hub-url URL --scenario NAME [--token TOKEN] [--path REMOTE_DIR] [--dry-run] [-- EXTRA_ARGS...]",
            "synchronize remote harness HOST --hub-url URL --all [--token TOKEN] [--path REMOTE_DIR] [--dry-run] [-- EXTRA_ARGS...]",
          ],
          positionals: [{ name: "HOST", description: "SSH host", required: true }],
          flags: [
            { name: "hub-url", description: "Hub daemon URL", required: true },
            { name: "scenario", description: "Scenario to run", value: { kind: "enum", values: ["cli-dm", "cli-group-policy", "pi-dm", "pi-group-policy", "pi-thread-baton", "pi-revival", "pi_mcp_archive_resume"] } },
            { name: "all", description: "Run every scenario", boolean: true },
            { name: "token", description: "Bearer token for the hub" },
            { name: "path", description: "Remote runtime dir" },
            { name: "dry-run", description: "Print the plan without running it", boolean: true },
          ],
          passthrough: { marker: "--", description: "Extra args appended to each scenario" },
        },
        { name: "status", description: "Hub health + agent roster grouped by machine", usage: ["synchronize remote status"] },
        { name: "doctor", description: "Readiness checklist for the active connection", usage: ["synchronize remote doctor"] },
      ],
    },
  ],
  environment: [
    { name: "SYNCHRONIZE_HOME", description: "Runtime directory (default: ~/.synchronize)" },
    { name: "SYNCHRONIZE_BIND", description: "Daemon bind host (default: 127.0.0.1)" },
    { name: "SYNCHRONIZE_PORT", description: "Daemon port (default: 0, random free port)" },
    { name: "SYNCHRONIZE_TOKEN", description: "Bearer token; required for non-localhost bind" },
    { name: "SYNCHRONIZE_REMOTE_URL", description: "Use an existing daemon URL; disables local autostart" },
  ],
};

export function topLevelCommandNames(schema: CliSchema = cliSchema): string[] {
  return schema.commands.flatMap((command) => [command.name, ...(command.aliases ?? [])]);
}
