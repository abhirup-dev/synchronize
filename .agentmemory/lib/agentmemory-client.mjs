export function createAgentMemoryClient({
  baseUrl,
  secret,
  timeoutMs = 60_000,
  fetchImpl = globalThis.fetch,
}) {
  if (!baseUrl) throw new Error("AgentMemory baseUrl is required");
  const normalizedBase = baseUrl.replace(/\/$/, "");

  async function request(endpoint, { method = "GET", body } = {}) {
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (secret) headers.Authorization = `Bearer ${secret}`;

    let response;
    try {
      response = await fetchImpl(`${normalizedBase}${endpoint}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new Error(
        `AgentMemory ${method} ${endpoint} failed: ${error.message}`,
      );
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `AgentMemory ${method} ${endpoint} returned HTTP ${response.status}` +
          (detail ? `: ${detail.slice(0, 300)}` : ""),
      );
    }
    return response.json();
  }

  return {
    request,
    getHealth: () => request("/agentmemory/health"),
    getFlags: () => request("/agentmemory/config/flags"),
    getSessions: () => request("/agentmemory/sessions"),
    getBranchWorktrees: (cwd) =>
      request(
        `/agentmemory/branch/worktrees?cwd=${encodeURIComponent(cwd)}`,
      ),
    getObservations: (sessionId) =>
      request(
        `/agentmemory/observations?sessionId=${encodeURIComponent(sessionId)}`,
      ),
    getGraphStats: () => request("/agentmemory/graph/stats"),
    queryGraph: (body) =>
      request("/agentmemory/graph/query", { method: "POST", body }),
    getSemantic: () => request("/agentmemory/semantic"),
    getMemories: () => request("/agentmemory/memories"),
    diagnose: (body = {}) =>
      request("/agentmemory/diagnostics", { method: "POST", body }),
  };
}
