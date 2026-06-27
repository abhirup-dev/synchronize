export const tokenDefinitionFiles = ["src/styles/tokens.css", "src/tw.css"];

export const rawColorAllowed = [
  /^src\/styles\/tokens\.css$/,
  /^src\/skin-glass\.css$/,
  /^src\/styles\/code-light\.css$/,
  /^src\/chat-bg\.css$/,
  /^src\/data\/chatBackgrounds\.ts$/,
  /^src\/data\/seed\.ts$/,
  /^src\/theme\/identity\.ts$/,
  /^src\/theme\/contrast\.ts$/,
  /^src\/components\/AgentColorPicker\.tsx$/,
  /^src\/.*\.stories\.tsx$/,
];

export const themeSelectorAllowed = [
  /^src\/styles\/tokens\.css$/,
  /^src\/styles\/code-light\.css$/,
  /^src\/chat-bg\.css$/,
  /^src\/skin-glass\.css$/,
];

export const legacyUndefinedVars = ["--opt-color"];

export const requiredResolvedTokens = [
  "--paper",
  "--paper-2",
  "--paper-3",
  "--ink",
  "--ink-soft",
  "--ink-faint",
  "--rule",
  "--muted",
  "--accent",
  "--on-ink",
  "--on-accent",
  "--surface",
  "--surface-raised",
  "--surface-sunken",
  "--fg",
  "--fg-soft",
  "--fg-faint",
  "--card-border",
  "--card-shadow",
  "--card-shadow-hover",
  "--card-shadow-raised",
  "--card-radius",
  "--bubble",
  "--bubble-border",
  "--bubble-shadow",
  "--control-border",
  "--control-shadow",
  "--control-shadow-hover",
  "--control-radius",
  "--overlay-border",
  "--overlay-shadow",
  "--overlay-radius",
  "--focus-ring",
  "--composer-bg",
  "--composer-border",
  "--composer-shadow",
  "--composer-control-bg",
  "--composer-control-fg",
  "--composer-control-border",
  "--composer-control-shadow",
  "--composer-send-bg",
  "--composer-send-fg",
  "--composer-send-border",
  "--composer-send-shadow",
  "--activity-row-bg",
  "--activity-row-border",
  "--activity-row-shadow",
  "--activity-control-bg",
  "--activity-control-fg",
  "--activity-control-border",
  "--activity-control-active-bg",
  "--activity-control-active-fg",
  "--archived-room-bg",
  "--archived-room-fg",
  "--archived-room-border",
  "--status-online",
  "--status-busy",
  "--status-idle",
  "--status-offline",
  "--code-bg",
  "--code-inline-bg",
  "--code-inline-fg",
  "--code-inline-border",
];

for (let index = 0; index < 16; index += 1) {
  requiredResolvedTokens.push(`--identity-${index}-bg`);
  requiredResolvedTokens.push(`--identity-${index}-fg`);
  requiredResolvedTokens.push(`--identity-${index}-border`);
  requiredResolvedTokens.push(`--identity-${index}-text`);
}
