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
  synchronize group create NAME --as SESSION_NAME [--ephemeral]
  synchronize group join NAME --as SESSION_NAME [--alias ALIAS] [--fresh]
  synchronize group leave NAME --as SESSION_NAME
  synchronize group rename NAME NEW_ALIAS --as SESSION_NAME
  synchronize group send NAME --as SESSION_NAME MESSAGE
  synchronize group history NAME --as SESSION_NAME
  synchronize media share GROUP FILE --description TEXT
  synchronize media list GROUP [--query TEXT]
  synchronize media get MEDIA_ID
  synchronize hook claude-session
  synchronize launch claude [--name NAME] [--] [CLAUDE_ARGS...]
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
  hook      Internal host-agent hook ingestion commands
  launch    Start an agent with synchronize daemon/env setup

Environment:
  SYNCHRONIZE_HOME    Runtime directory (default: ~/.synchronize)
  SYNCHRONIZE_BIND    Daemon bind host (default: 127.0.0.1)
  SYNCHRONIZE_PORT    Daemon port (default: 0, random free port)
  SYNCHRONIZE_TOKEN   Bearer token; required for non-localhost bind
`);
}
