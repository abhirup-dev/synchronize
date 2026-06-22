// Synchronize channel plugin for Letta Code (dynamic user channel).
//
// Bridges the synchronize message bus to Letta Code's channel system so any
// Letta agent becomes a NATIVE synchronize peer: inbound bus events (DMs /
// group messages) are delivered to the agent as channel messages, and the
// agent replies via the built-in MessageChannel tool.
//
// Proper integration (beyond the PoC):
//   - registers via /agent-sessions/register with full identity
//     (tool=letta, host_tool, source, agent_type, model, metadata)
//   - heartbeats each peer to keep its presence lease alive
//   - drives activity state (working on delivery, idle after reply)
//   - joins configured groups so group_message events are delivered
//   - acks the durable inbox as the consumption cursor + dedups by event_id
//   - reconnects with backoff and re-registers after transport failures
//   - threads replies to the triggering event_id (DM or group)
//
// Multi-agent by design: one running `letta server --channels synchronize`
// serves every peer in accounts.json `config.peers`. routing.yaml binds
// chatId -> agent. Onboarding a new Letta agent is config, never code.
//
// Self-contained: talks to the synchronize daemon over its REST API via fetch.

const CHANNEL_ID = "synchronize";
const DEFAULT_POLL_MS = 1500;
const DEFAULT_HEARTBEAT_MS = 15000;
const IDLE_AFTER_MS = 120000; // safety: drop to idle if a turn yields no reply
const MAX_BACKOFF_MS = 30000;

function makeClient(daemonUrl, token) {
  const base = String(daemonUrl).replace(/\/$/, "");
  const baseHeaders = { accept: "application/json", "content-type": "application/json; charset=utf-8" };
  if (token) baseHeaders.authorization = `Bearer ${token}`;
  async function req(path, init = {}) {
    const res = await fetch(`${base}${path}`, { ...init, headers: { ...baseHeaders, ...(init.headers || {}) } });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = body?.error?.message ?? `${res.status} ${res.statusText}`;
      const err = new Error(`synchronize ${path}: ${msg}`);
      err.status = res.status;
      throw err;
    }
    return body;
  }
  return {
    registerAgentSession: (input) =>
      req("/agent-sessions/register", {
        method: "POST",
        body: JSON.stringify({
          peer_id: input.peerId,
          session_name: input.sessionName,
          purpose: input.purpose,
          tool: "letta",
          host_tool: "letta",
          host_session_id: input.hostSessionId,
          cwd: input.cwd,
          pid: input.pid,
          source: "letta-channel",
          agent_type: "letta-channel",
          ...(input.model ? { model: input.model } : {}),
          metadata: { channel: CHANNEL_ID, account: input.accountId, chat_id: input.chatId },
        }),
      }),
    heartbeat: (peerId) => req(`/peers/${encodeURIComponent(peerId)}/heartbeat`, { method: "PATCH" }),
    setActivity: (peerId, state) =>
      req("/peers/activity", { method: "POST", body: JSON.stringify({ peer_id: peerId, state }) }),
    joinGroup: (group, peerId, alias) =>
      req(`/groups/${encodeURIComponent(group)}/join`, {
        method: "POST",
        body: JSON.stringify({ peer_id: peerId, ...(alias ? { alias } : {}) }),
      }),
    readInbox: (peerId) => req(`/peers/${encodeURIComponent(peerId)}/inbox`),
    ackInbox: (peerId, eventIds) =>
      req(`/peers/${encodeURIComponent(peerId)}/inbox/ack`, { method: "POST", body: JSON.stringify({ event_ids: eventIds }) }),
    reply: (senderPeerId, inReplyTo, message) =>
      req("/reply", { method: "POST", body: JSON.stringify({ sender_peer_id: senderPeerId, in_reply_to: inReplyTo, message }) }),
    dm: (senderPeerId, recipientPeerId, message) =>
      req("/dm", { method: "POST", body: JSON.stringify({ sender_peer_id: senderPeerId, recipient_peer_id: recipientPeerId, message }) }),
  };
}

function log(msg) {
  console.error(`[synchronize] ${msg}`);
}

export const channelPlugin = {
  metadata: { id: CHANNEL_ID, displayName: "Synchronize", runtimePackages: [], runtimeModules: [] },

  async createAdapter(account) {
    const config = account.config ?? {};
    const daemonUrl = config.daemonUrl || config.daemon_url || "http://localhost:8283";
    const token = config.token || config.SYNCHRONIZE_TOKEN || "";
    const pollMs = Number(config.pollMs || config.poll_ms || DEFAULT_POLL_MS);
    const heartbeatMs = Number(config.heartbeatMs || config.heartbeat_ms || DEFAULT_HEARTBEAT_MS);
    const client = makeClient(daemonUrl, token);
    const peerSpecs = Array.isArray(config.peers) ? config.peers : [];

    let onMessageHandler = null;
    let running = false;
    let pollTimer = null;
    let heartbeatTimer = null;
    let backoff = 0;

    // chatId -> peer record
    const peers = new Map();
    const peerByChat = (chatId) => peers.get(chatId);

    function makePeer(spec) {
      const sessionName = spec.sessionName || spec.session_name || spec.chatId || spec.chat_id;
      const chatId = spec.chatId || spec.chat_id || sessionName;
      return {
        chatId,
        sessionName,
        configuredPeerId: spec.peerId || spec.peer_id,
        groups: Array.isArray(spec.groups) ? spec.groups : [],
        model: spec.model || config.model,
        peerId: null,
        seen: new Set(),
        lastEvent: null,
        idleTimer: null,
      };
    }

    async function registerPeer(p) {
      const res = await client.registerAgentSession({
        peerId: p.peerId || p.configuredPeerId,
        sessionName: p.sessionName,
        purpose: "Letta agent on synchronize (native channel)",
        hostSessionId: `letta-channel:${p.chatId}`,
        cwd: process.cwd(),
        pid: process.pid,
        model: p.model,
        accountId: account.accountId,
        chatId: p.chatId,
      });
      p.peerId = res.binding?.peer_id ?? res.binding?.peer?.peer_id ?? p.peerId;
      return p.peerId;
    }

    async function joinGroups(p) {
      for (const group of p.groups) {
        try {
          await client.joinGroup(group, p.peerId, p.sessionName);
          log(`peer ${p.sessionName} joined group ${group}`);
        } catch (err) {
          log(`join group ${group} failed for ${p.sessionName}: ${err?.message ?? err}`);
        }
      }
    }

    function setWorking(p) {
      client.setActivity(p.peerId, "working").catch(() => {});
      if (p.idleTimer) clearTimeout(p.idleTimer);
      p.idleTimer = setTimeout(() => {
        client.setActivity(p.peerId, "idle").catch(() => {});
        p.idleTimer = null;
      }, IDLE_AFTER_MS);
    }

    function setIdle(p) {
      if (p.idleTimer) clearTimeout(p.idleTimer);
      p.idleTimer = null;
      client.setActivity(p.peerId, "idle").catch(() => {});
    }

    async function ensurePeers() {
      for (const spec of peerSpecs) {
        const p = makePeer(spec);
        try {
          await registerPeer(p);
          if (!p.peerId) {
            log(`could not resolve peer_id for chatId=${p.chatId}; skipping`);
            continue;
          }
          peers.set(p.chatId, p);
          await joinGroups(p);
          await client.setActivity(p.peerId, "idle").catch(() => {});
          log(`peer ready chatId=${p.chatId} session=${p.sessionName} peer_id=${p.peerId} groups=[${p.groups.join(",")}]`);
        } catch (err) {
          log(`register failed chatId=${p.chatId}: ${err?.message ?? err}`);
        }
      }
    }

    async function deliver(p, ev) {
      p.lastEvent = ev.event_id;
      setWorking(p);
      await onMessageHandler({
        channel: CHANNEL_ID,
        accountId: account.accountId,
        chatId: p.chatId,
        senderId: ev.sender_peer_id ?? "unknown",
        senderName: ev.sender_peer_id ?? undefined,
        chatLabel: ev.group_name ? `group:${ev.group_name}` : `dm:${p.sessionName}`,
        text: String(ev.body),
        timestamp: Date.parse(ev.created_at) || Date.now(),
        messageId: String(ev.event_id),
        threadId: ev.group_name ?? null,
        chatType: ev.type === "dm" ? "direct" : "channel",
        isMention: ev.type === "dm",
        raw: ev,
      });
    }

    async function pollPeer(p) {
      const inbox = await client.readInbox(p.peerId);
      const acked = [];
      for (const ev of inbox.events ?? []) {
        if (p.seen.has(ev.event_id)) continue;
        p.seen.add(ev.event_id);
        acked.push(ev.event_id);
        if (ev.sender_peer_id === p.peerId) continue;
        if (ev.type !== "dm" && ev.type !== "group_message") continue;
        if (!ev.body || !String(ev.body).trim()) continue;
        try {
          await deliver(p, ev);
        } catch (err) {
          log(`deliver error chatId=${p.chatId} event=${ev.event_id}: ${err?.message ?? err}`);
        }
      }
      if (acked.length) await client.ackInbox(p.peerId, acked).catch((err) => log(`ack failed ${p.peerId}: ${err?.message ?? err}`));
    }

    async function pollOnce() {
      if (!onMessageHandler) return;
      let failed = false;
      for (const p of peers.values()) {
        if (!p.peerId) continue;
        try {
          await pollPeer(p);
        } catch (err) {
          failed = true;
          log(`poll failed ${p.sessionName} (${p.peerId}): ${err?.message ?? err}`);
          // Re-register on auth/identity loss (daemon restart, lease lapse).
          if (err?.status === 401 || err?.status === 404) {
            try {
              await registerPeer(p);
              await joinGroups(p);
            } catch (reErr) {
              log(`re-register failed ${p.sessionName}: ${reErr?.message ?? reErr}`);
            }
          }
        }
      }
      backoff = failed ? Math.min(backoff ? backoff * 2 : pollMs, MAX_BACKOFF_MS) : 0;
    }

    function schedulePoll() {
      if (!running) return;
      pollTimer = setTimeout(async () => {
        await pollOnce();
        schedulePoll();
      }, backoff || pollMs);
    }

    function startHeartbeat() {
      heartbeatTimer = setInterval(() => {
        for (const p of peers.values()) {
          if (p.peerId) client.heartbeat(p.peerId).catch((err) => log(`heartbeat failed ${p.peerId}: ${err?.message ?? err}`));
        }
      }, heartbeatMs);
    }

    return {
      id: `${CHANNEL_ID}:${account.accountId}`,
      channelId: CHANNEL_ID,
      accountId: account.accountId,
      name: account.displayName ?? "Synchronize",
      async start() {
        running = true;
        await ensurePeers();
        log(`started: ${peers.size} peer(s), daemon=${daemonUrl}, poll=${pollMs}ms, heartbeat=${heartbeatMs}ms`);
        startHeartbeat();
        schedulePoll();
      },
      async stop() {
        running = false;
        if (pollTimer) clearTimeout(pollTimer);
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        for (const p of peers.values()) if (p.idleTimer) clearTimeout(p.idleTimer);
        pollTimer = heartbeatTimer = null;
      },
      isRunning() {
        return running;
      },
      // Outbound: agent MessageChannel.send -> handleAction -> here.
      async sendMessage(msg) {
        const p = peerByChat(msg.chatId);
        if (!p || !p.peerId) throw new Error(`unknown chatId ${msg.chatId}`);
        const inReplyTo = msg.replyToMessageId ? Number(msg.replyToMessageId) : p.lastEvent;
        if (!inReplyTo) {
          throw new Error("no inbound event to reply to; use bridge_* tools for proactive sends");
        }
        const res = await client.reply(p.peerId, inReplyTo, msg.text);
        setIdle(p);
        return { messageId: String(res.event?.event_id ?? inReplyTo) };
      },
      async sendDirectReply() {
        // System notices (pairing / "not connected"). N/A: open policy, no human DM.
      },
      get onMessage() {
        return onMessageHandler;
      },
      set onMessage(handler) {
        onMessageHandler = handler;
      },
    };
  },

  messageActions: {
    describeMessageTool() {
      return { actions: ["send"] };
    },
    async handleAction({ adapter, request, formatText }) {
      if (request.action !== "send") return `Error: unsupported action ${request.action}`;
      const formatted = formatText ? formatText(request.message ?? "") : { text: request.message ?? "" };
      try {
        const result = await adapter.sendMessage({
          channel: request.channel,
          chatId: request.chatId,
          text: formatted.text ?? request.message ?? "",
          replyToMessageId: request.replyToMessageId,
          threadId: request.threadId,
        });
        return `Delivered to synchronize (event_id: ${result.messageId})`;
      } catch (err) {
        return `Error sending to synchronize: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  },
};

export default channelPlugin;
