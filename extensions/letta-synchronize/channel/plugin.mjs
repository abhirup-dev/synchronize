// Synchronize channel plugin for Letta Code (dynamic user channel).
//
// Bridges the synchronize message bus to Letta Code's channel system so any
// Letta agent becomes a NATIVE synchronize peer: inbound bus events (DMs /
// group messages) are delivered to the agent as channel messages, and the
// agent replies via the built-in MessageChannel tool.
//
// Multi-agent by design: one running `letta server --channels synchronize`
// serves every peer listed in accounts.json `config.peers`. Each peer maps to
// a chatId; routing.yaml binds chatId -> agent. Onboarding a new Letta agent
// is a config + `letta channels route add` change, never a code edit.
//
// Self-contained: talks to the synchronize daemon over its REST API via fetch,
// so it has no runtime dependencies and does not import the synchronize repo.

const CHANNEL_ID = "synchronize";

function nowIso() {
  return new Date().toISOString();
}

function makeClient(daemonUrl, token) {
  const base = String(daemonUrl).replace(/\/$/, "");
  const headers = { accept: "application/json", "content-type": "application/json; charset=utf-8" };
  if (token) headers.authorization = `Bearer ${token}`;
  async function req(path, init = {}) {
    const res = await fetch(`${base}${path}`, { ...init, headers: { ...headers, ...(init.headers || {}) } });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = body?.error?.message ?? `${res.status} ${res.statusText}`;
      throw new Error(`synchronize ${path}: ${msg}`);
    }
    return body;
  }
  return {
    registerPeer: (input) =>
      req("/peers/register", {
        method: "POST",
        body: JSON.stringify({
          peer_id: input.peerId,
          session_name: input.sessionName,
          tool: input.tool ?? "letta",
          purpose: input.purpose,
        }),
      }),
    readInbox: (peerId) => req(`/peers/${encodeURIComponent(peerId)}/inbox`),
    ackInbox: (peerId, eventIds) =>
      req(`/peers/${encodeURIComponent(peerId)}/inbox/ack`, {
        method: "POST",
        body: JSON.stringify({ event_ids: eventIds }),
      }),
    reply: (input) =>
      req("/reply", {
        method: "POST",
        body: JSON.stringify({ sender_peer_id: input.senderPeerId, in_reply_to: input.inReplyTo, message: input.message }),
      }),
    dm: (input) =>
      req("/dm", {
        method: "POST",
        body: JSON.stringify({ sender_peer_id: input.senderPeerId, recipient_peer_id: input.recipientPeerId, message: input.message }),
      }),
  };
}

export const channelPlugin = {
  metadata: {
    id: CHANNEL_ID,
    displayName: "Synchronize",
    runtimePackages: [],
    runtimeModules: [],
  },

  async createAdapter(account) {
    const config = account.config ?? {};
    const daemonUrl = config.daemonUrl || config.daemon_url || "http://localhost:8283";
    const token = config.token || config.SYNCHRONIZE_TOKEN || "";
    const pollMs = Number(config.pollMs || config.poll_ms || 1500);
    const client = makeClient(daemonUrl, token);

    // Each entry: { chatId, sessionName, peerId? }. peerId is resolved at start.
    const peerSpecs = Array.isArray(config.peers) ? config.peers : [];

    let onMessageHandler = null;
    let running = false;
    let timer = null;
    // chatId -> { peerId, sessionName }
    const chatToPeer = new Map();
    // peerId -> chatId
    const peerToChat = new Map();
    // peerId -> Set(seen event_id)
    const seen = new Map();
    // chatId -> last inbound event_id (for reply threading when none given)
    const lastEvent = new Map();

    function log(msg) {
      console.error(`[synchronize] ${msg}`);
    }

    async function ensurePeers() {
      for (const spec of peerSpecs) {
        const sessionName = spec.sessionName || spec.session_name || spec.chatId;
        const chatId = spec.chatId || spec.chat_id || sessionName;
        try {
          const res = await client.registerPeer({
            peerId: spec.peerId || spec.peer_id,
            sessionName,
            tool: "letta",
            purpose: spec.purpose || "Letta agent on synchronize via channel plugin",
          });
          const peerId = res.peer?.peer_id ?? res.binding?.peer_id ?? spec.peerId;
          if (!peerId) {
            log(`could not resolve peer_id for chatId=${chatId}; skipping`);
            continue;
          }
          chatToPeer.set(chatId, { peerId, sessionName });
          peerToChat.set(peerId, chatId);
          if (!seen.has(peerId)) seen.set(peerId, new Set());
          log(`peer ready chatId=${chatId} session=${sessionName} peer_id=${peerId}`);
        } catch (err) {
          log(`register failed chatId=${chatId}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    async function pollOnce() {
      if (!onMessageHandler) return;
      for (const [chatId, { peerId, sessionName }] of chatToPeer) {
        let inbox;
        try {
          inbox = await client.readInbox(peerId);
        } catch (err) {
          log(`inbox poll failed peer=${peerId}: ${err instanceof Error ? err.message : String(err)}`);
          continue;
        }
        const seenSet = seen.get(peerId);
        const acked = [];
        for (const ev of inbox.events ?? []) {
          if (seenSet.has(ev.event_id)) continue;
          seenSet.add(ev.event_id);
          acked.push(ev.event_id);
          if (ev.sender_peer_id === peerId) continue; // ignore our own
          if (ev.type !== "dm" && ev.type !== "group_message") continue;
          if (!ev.body || !String(ev.body).trim()) continue;
          lastEvent.set(chatId, ev.event_id);
          try {
            await onMessageHandler({
              channel: CHANNEL_ID,
              accountId: account.accountId,
              chatId,
              senderId: ev.sender_peer_id ?? "unknown",
              senderName: ev.sender_peer_id ?? undefined,
              chatLabel: ev.group_name ? `group:${ev.group_name}` : `dm:${sessionName}`,
              text: String(ev.body),
              timestamp: Date.parse(ev.created_at) || Date.now(),
              messageId: String(ev.event_id),
              threadId: ev.group_name ?? null,
              chatType: ev.type === "dm" ? "direct" : "channel",
              isMention: ev.type === "dm",
              raw: ev,
            });
          } catch (err) {
            log(`onMessage handler error chatId=${chatId} event=${ev.event_id}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        if (acked.length) {
          try {
            await client.ackInbox(peerId, acked);
          } catch (err) {
            log(`ack failed peer=${peerId}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }
    }

    function schedule() {
      if (!running) return;
      timer = setTimeout(async () => {
        await pollOnce();
        schedule();
      }, pollMs);
    }

    return {
      id: `${CHANNEL_ID}:${account.accountId}`,
      channelId: CHANNEL_ID,
      accountId: account.accountId,
      name: account.displayName ?? "Synchronize",
      async start() {
        running = true;
        await ensurePeers();
        log(`started: ${chatToPeer.size} peer(s), daemon=${daemonUrl}, poll=${pollMs}ms`);
        schedule();
      },
      async stop() {
        running = false;
        if (timer) clearTimeout(timer);
        timer = null;
      },
      isRunning() {
        return running;
      },
      // Outbound: agent's MessageChannel.send -> handleAction -> here.
      async sendMessage(msg) {
        const chatId = msg.chatId;
        const entry = chatToPeer.get(chatId);
        if (!entry) throw new Error(`unknown chatId ${chatId}`);
        const inReplyTo = msg.replyToMessageId ? Number(msg.replyToMessageId) : lastEvent.get(chatId);
        if (inReplyTo) {
          const res = await client.reply({ senderPeerId: entry.peerId, inReplyTo, message: msg.text });
          return { messageId: String(res.event?.event_id ?? crypto.randomUUID()) };
        }
        // No event to reply to (proactive send). Without a recipient we can't
        // route a bare DM; surface that so the agent uses bridge_* MCP tools.
        throw new Error("no inbound event to reply to; use bridge_* tools for proactive sends");
      },
      async sendDirectReply() {
        // System notices (pairing/"not connected"). Not applicable: open policy, no human DM.
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
