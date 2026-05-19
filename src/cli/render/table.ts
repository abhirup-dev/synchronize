export function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, index) => {
    const maxCell = Math.max(header.length, ...rows.map((row) => (row[index] ?? "").length));
    return Math.min(Math.max(maxCell, 4), index === 3 ? 28 : 22);
  });
  const renderRow = (row: string[]) => row.map((cell, index) => fit(cell, widths[index] ?? 12)).join("  ");
  const divider = widths.map((width) => "-".repeat(width)).join("  ");
  const body = rows.length > 0 ? rows.map(renderRow) : ["(none)"];
  return [renderRow(headers), divider, ...body].join("\n");
}

export function fit(value: string, width: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length > width) return `${clean.slice(0, Math.max(0, width - 1))}~`;
  return clean.padEnd(width, " ");
}

export function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)}${units[unit]}`;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0s";
  const seconds = Math.floor(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  if (hours > 0) return `${hours}h${minutes}m`;
  if (minutes > 0) return `${minutes}m${remaining}s`;
  return `${remaining}s`;
}

export function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "unknown";
  if (ms < 5_000) return "now";
  return `${formatDuration(ms)} ago`;
}
