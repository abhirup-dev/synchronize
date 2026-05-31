import { requestJson, type ClientConfig } from "../client.ts";
import type { ReplyResponse } from "./types.ts";

export function replyToEvent(
  client: ClientConfig,
  input: { senderPeerId: string; inReplyTo: number; message: string },
): Promise<ReplyResponse> {
  return requestJson<ReplyResponse>(client, "/reply", {
    method: "POST",
    body: JSON.stringify({
      sender_peer_id: input.senderPeerId,
      in_reply_to: input.inReplyTo,
      message: input.message,
    }),
  });
}
