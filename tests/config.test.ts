import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  emptyConfig,
  loadConfig,
  normalizeConfig,
  parseConfig,
  removeProfile,
  resolveConnection,
  resolveProfile,
  serializeConfig,
  setActiveProfile,
  upsertProfile,
  type SynchronizeConfig,
} from "../src/config.ts";

const dirs: string[] = [];
afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

const FULL_TOML = `
active = "hub"

[remote.hub]
url = "http://100.126.163.80:58412"
token_env = "SYNCHRONIZE_TOKEN"
health_timeout_ms = 5000

[remote.hub.sync]
ssh_host = "vpsme"
paths = [".claude/skills", ".mcp.json"]

[remote.vpsme]
ssh_host = "vpsme"
runtime_path = "~/synchronize-letta-test"
expose = "ssh-reverse"
remote_port = 58455
install = false

[remote.laptop]
url = "http://100.64.0.9:58412"
token = "literal-token"

[letta.server.vps]
remote = "vpsme"
base_url = "http://127.0.0.1:8283"
api_key_env = "LETTA_API_KEY"

[agent.rocky]
tool = "letta"
server = "vps"
session_name = "rocky"
agent_id = "agent-814dab68-2d4d-4cac-9f29-86d987494b13"
conversation_id = "default"
poll_ms = 1000
`;

test("parseConfig normalizes a full config into camelCase profiles", () => {
  const config = parseConfig(FULL_TOML);
  expect(config.active).toBe("hub");
  expect(config.remotes.hub).toEqual({
    url: "http://100.126.163.80:58412",
    tokenEnv: "SYNCHRONIZE_TOKEN",
    healthTimeoutMs: 5000,
    sync: { sshHost: "vpsme", paths: [".claude/skills", ".mcp.json"] },
  });
  expect(config.remotes.laptop).toEqual({ url: "http://100.64.0.9:58412", token: "literal-token" });
  expect(config.remotes.vpsme).toEqual({
    sshHost: "vpsme",
    runtimePath: "~/synchronize-letta-test",
    expose: "ssh-reverse",
    remotePort: 58455,
    install: false,
  });
  expect(config.lettaServers?.vps).toEqual({
    remote: "vpsme",
    baseUrl: "http://127.0.0.1:8283",
    apiKeyEnv: "LETTA_API_KEY",
  });
  expect(config.agents?.rocky).toEqual({
    tool: "letta",
    server: "vps",
    sessionName: "rocky",
    agentId: "agent-814dab68-2d4d-4cac-9f29-86d987494b13",
    conversationId: "default",
    pollMs: 1000,
  });
});

test("parseConfig supports launch profile bin and env source descriptors", () => {
  const config = parseConfig(`
[agent.glaude]
tool = "claude"
bin = "/opt/bin/claude"
repo = "/repo"
model = "claude-haiku-4-5-20251001"
args = ["--verbose"]
session_name = "reviewer"

[agent.glaude.env]
ANTHROPIC_BASE_URL = "https://api.example.test/anthropic"
ANTHROPIC_AUTH_TOKEN = { from_env = "ZAI_API_TOKEN" }
SSL_CERT_FILE = { from_file = "/tmp/cert.pem" }
`);

  expect(config.agents?.glaude).toEqual({
    tool: "claude",
    bin: "/opt/bin/claude",
    repo: "/repo",
    model: "claude-haiku-4-5-20251001",
    args: ["--verbose"],
    sessionName: "reviewer",
    env: {
      ANTHROPIC_BASE_URL: "https://api.example.test/anthropic",
      ANTHROPIC_AUTH_TOKEN: { fromEnv: "ZAI_API_TOKEN" },
      SSL_CERT_FILE: { fromFile: "/tmp/cert.pem" },
    },
  });
});

test("parseConfig throws on malformed TOML", () => {
  expect(() => parseConfig("this is = = not toml [[[")).toThrow(/not valid TOML/);
});

test("normalizeConfig drops profiles without a url and a dangling active", () => {
  const config = normalizeConfig({ active: "ghost", remote: { ghost: { token: "x" }, ok: { url: "http://h:1" } } });
  expect(config.remotes.ghost).toBeUndefined(); // no url => unusable
  expect(config.remotes.ok).toEqual({ url: "http://h:1" });
  expect(config.active).toBeUndefined(); // active named a dropped profile
});

test("loadConfig treats a missing file as an empty config, not an error", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sync-config-"));
  dirs.push(dir);
  const config = await loadConfig(join(dir, "config.toml"));
  expect(config).toEqual(emptyConfig());
});

test("loadConfig reads and parses an on-disk file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sync-config-"));
  dirs.push(dir);
  const path = join(dir, "config.toml");
  await writeFile(path, FULL_TOML);
  const config = await loadConfig(path);
  expect(config.active).toBe("hub");
  expect(Object.keys(config.remotes).sort()).toEqual(["hub", "laptop", "vpsme"]);
});

test("resolveConnection: explicit env vars win over the active profile", () => {
  const config = parseConfig(FULL_TOML);
  const env = {
    SYNCHRONIZE_REMOTE_URL: "http://override:9999",
    SYNCHRONIZE_TOKEN: "env-token",
    SYNCHRONIZE_HEALTH_TIMEOUT_MS: "1234",
  } as NodeJS.ProcessEnv;
  expect(resolveConnection(config, env)).toEqual({
    remoteUrl: "http://override:9999",
    token: "env-token",
    healthTimeoutMs: 1234,
  });
});

test("resolveConnection: falls back to the active profile, resolving token_env", () => {
  const config = parseConfig(FULL_TOML);
  const env = { SYNCHRONIZE_TOKEN: undefined, MY_TOKEN: "from-named-env" } as unknown as NodeJS.ProcessEnv;
  // hub uses token_env=SYNCHRONIZE_TOKEN; point it at a set var via override
  const cfg2 = upsertProfile(
    config,
    "hub",
    { url: "http://100.126.163.80:58412", tokenEnv: "MY_TOKEN", healthTimeoutMs: 5000 },
    { makeActive: true },
  );
  expect(resolveConnection(cfg2, env)).toEqual({
    remoteUrl: "http://100.126.163.80:58412",
    token: "from-named-env",
    healthTimeoutMs: 5000,
  });
});

test("resolveConnection: literal profile token used when token_env is unset/missing", () => {
  const config = setActiveProfile(parseConfig(FULL_TOML), "laptop");
  expect(resolveConnection(config, {} as NodeJS.ProcessEnv)).toEqual({
    remoteUrl: "http://100.64.0.9:58412",
    token: "literal-token",
    healthTimeoutMs: null,
  });
});

test("resolveConnection: no profile and no env => unset (local discovery)", () => {
  expect(resolveConnection(emptyConfig(), {} as NodeJS.ProcessEnv)).toEqual({
    remoteUrl: null,
    token: null,
    healthTimeoutMs: null,
  });
});

test("upsertProfile makes the first profile active; setActiveProfile validates", () => {
  let config: SynchronizeConfig = emptyConfig();
  config = upsertProfile(config, "hub", { url: "http://h:1" });
  expect(config.active).toBe("hub"); // first profile auto-active
  config = upsertProfile(config, "laptop", { url: "http://l:1" });
  expect(config.active).toBe("hub"); // adding another does not steal active
  config = setActiveProfile(config, "laptop");
  expect(config.active).toBe("laptop");
  expect(() => setActiveProfile(config, "nope")).toThrow(/No such profile/);
});

test("serializeConfig round-trips through parseConfig", () => {
  const config = parseConfig(FULL_TOML);
  const reparsed = parseConfig(serializeConfig(config));
  expect(reparsed).toEqual(config);
});

test("removeProfile drops the profile and clears active only if it matched", () => {
  let config = parseConfig(FULL_TOML); // active=hub
  config = removeProfile(config, "laptop");
  expect(config.remotes.laptop).toBeUndefined();
  expect(config.active).toBe("hub"); // active untouched
  config = removeProfile(config, "hub");
  expect(config.remotes.hub).toBeUndefined();
  expect(config.active).toBeUndefined(); // active was hub => cleared
});

test("resolveProfile returns active, named, or null", () => {
  const config = parseConfig(FULL_TOML);
  expect(resolveProfile(config)?.url).toBe("http://100.126.163.80:58412"); // active=hub
  expect(resolveProfile(config, "laptop")?.url).toBe("http://100.64.0.9:58412");
  expect(resolveProfile(emptyConfig())).toBeNull();
});
