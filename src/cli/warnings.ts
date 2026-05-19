export function printCliRealtimeWarning(): void {
  console.error(
    [
      "synchronize CLI fallback warning:",
      "  Claude channel real-time notifications do not work through CLI peers.",
      "  CLI peers do not attach a Claude channel subscription, so auto-prompt messages will not appear.",
      "  Use MCP bridge_register/bridge_dm for real-time Claude channel delivery; with CLI, use inbox polling/checking.",
    ].join("\n"),
  );
}
