package dev.synchronize.android.data

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class SynchronizeRepositoryMappingTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun mapsSummaryGroupsDmsAgentsAndLaunchProfiles() {
        val payload = json.parseToJsonElement(
            """
            {
              "cursor": 42,
              "groups": [{"group_id": 4, "name": "SysHQ", "durable": true, "description": null, "created_at": "2026-07-05T00:00:00Z"}],
              "memberships": [
                {"group_id": 4, "peer_id": "web:local", "alias": "you", "active": true, "session_name": "web", "tool": "web", "purpose": null},
                {"group_id": 4, "peer_id": "agent:neo", "alias": "neovim-fix", "active": true, "session_name": "neovim-fix", "tool": "claude", "purpose": "nvim config fixes"}
              ],
              "room_summaries": [{"group_id": 4, "last_preview": "latest production message", "last_actor": "neovim-fix"}],
              "peers": [
                {"peer_id": "web:local", "tool": "web", "session_name": "web", "purpose": "local", "lease_expires_at": "", "online": true, "presence": "online"},
                {"peer_id": "agent:neo", "tool": "claude", "session_name": "neovim-fix", "purpose": "nvim config fixes", "lease_expires_at": "", "online": true, "presence": "working"}
              ],
              "agent_runtime_details": [
                {"peer_id": "agent:neo", "model": "claude-opus-4-8", "thinking": "high", "cwd": "/repo", "git_branch": "feat/native", "host_tool": "claude", "host_session_id": "session-1", "launch_state": "running"}
              ],
              "launch_tools": {"claude": {"tool": "claude", "available": true}, "pi": {"tool": "pi", "available": false}},
              "launch_profiles": [{"name": "glaude", "tool": "claude"}]
            }
            """.trimIndent(),
        ).jsonObject

        val mapped = SynchronizeRepository().mapSummary(payload, "web:local")

        assertEquals("SysHQ", mapped.rooms.first { it.kind == RoomKind.Group }.name)
        assertEquals("latest production message", mapped.rooms.first { it.kind == RoomKind.Group }.preview)
        assertEquals(2, mapped.rooms.first { it.kind == RoomKind.Group }.memberCount)
        assertEquals("neovim-fix", mapped.rooms.first { it.kind == RoomKind.Dm }.name)
        val agent = mapped.agents.first { it.peerId == "agent:neo" }
        assertEquals("claude-opus-4-8", agent.model)
        assertEquals("working", agent.presence)
        assertEquals("high", agent.thinking)
        assertTrue(mapped.launchTools.contains("claude"))
        assertFalse(mapped.launchTools.contains("pi"))
        assertEquals("glaude", mapped.launchProfiles.single().name)
    }

    @Test
    fun mapsThreadedRoomMessages() {
        val payload = json.parseToJsonElement(
            """
            {
              "peers": [
                {"peer_id": "web:local", "tool": "web", "session_name": "web", "purpose": "local", "lease_expires_at": "", "online": true},
                {"peer_id": "agent:neo", "tool": "claude", "session_name": "neovim-fix", "purpose": null, "lease_expires_at": "", "online": true}
              ],
              "events": [
                {"event_id": 10, "type": "group_message", "sender_peer_id": "web:local", "recipient_peer_id": null, "group_id": 4, "body": "parent", "media_id": null, "parent_event_id": null, "reply_to_event_id": null, "mentions_json": null, "skill_directives_json": null, "created_at": "2026-07-05T12:00:00Z", "reply_count": 1, "delivered_count": 1},
                {"event_id": 11, "type": "group_message", "sender_peer_id": "agent:neo", "recipient_peer_id": null, "group_id": 4, "body": "reply", "media_id": null, "parent_event_id": 10, "reply_to_event_id": 10, "mentions_json": null, "skill_directives_json": null, "created_at": "2026-07-05T12:01:00Z"}
              ]
            }
            """.trimIndent(),
        ).jsonObject

        val messages = SynchronizeRepository().mapMessages(payload, "web:local", "group:4")

        assertEquals(2, messages.size)
        assertTrue(messages.first { it.eventId == 10L }.self)
        assertEquals(1, messages.first { it.eventId == 10L }.replyCount)
        assertEquals(10L, messages.first { it.eventId == 11L }.parentEventId)
        assertEquals("neovim-fix", messages.first { it.eventId == 11L }.author)
    }
}
