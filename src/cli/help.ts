export function printHelp(): void {
  console.log(`synchronize

Usage:
  synchronize status
  synchronize top [--once] [--json] [--interval SECONDS]
  synchronize register --name NAME [--purpose TEXT]
  synchronize whoami
  synchronize peers
  synchronize dm PEER MESSAGE
  synchronize inbox [--ack]
  synchronize group create NAME --as SESSION_NAME [--ephemeral] [--description TEXT]
  synchronize group describe NAME DESCRIPTION | --clear
  synchronize group join NAME --as SESSION_NAME [--alias ALIAS] [--fresh]
  synchronize group leave NAME --as SESSION_NAME
  synchronize group rename NAME NEW_ALIAS --as SESSION_NAME
  synchronize group send NAME --as SESSION_NAME [--in-reply-to EVENT_ID] MESSAGE
  synchronize group history NAME --as SESSION_NAME [--thread-of EVENT_ID]
  synchronize media share GROUP FILE --description TEXT
  synchronize media list GROUP [--query TEXT]
  synchronize media get MEDIA_ID
  synchronize threads list [--group NAME] [--limit N]
  synchronize threads status ROOT_EVENT_ID
  synchronize threads show ROOT_EVENT_ID [--format json|transcript]
  synchronize threads summary ROOT_EVENT_ID [--refresh] [--strategy all|first_k|last_k|first_last] [--k N] [--first-k N] [--last-k N] [--format text|json]
  synchronize query [--format json|table|csv] [--params JSON] SQL
  synchronize hook claude-session
  synchronize launch claude [--name NAME] [--] [CLAUDE_ARGS...]
  synchronize spawn claude|pi --name NAME --repo PATH [--group GROUP] [--model MODEL] [--thinking LEVEL] [-- TOOL_ARGS...]
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
  threads   Discover, summarize, and render deeper group conversations
  query     Run guarded read-only SQL against daemon event state
  hook      Internal host-agent hook ingestion commands
  launch    Start an agent in the foreground with synchronize daemon/env setup
  spawn     Launch a persistent agent session via the backend (AOE), optionally into a group

Environment:
  SYNCHRONIZE_HOME    Runtime directory (default: ~/.synchronize)
  SYNCHRONIZE_BIND    Daemon bind host (default: 127.0.0.1)
  SYNCHRONIZE_PORT    Daemon port (default: 0, random free port)
  SYNCHRONIZE_TOKEN   Bearer token; required for non-localhost bind
`);
}
