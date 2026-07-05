package dev.synchronize.android.data

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources
import java.io.IOException
import java.net.URLEncoder
import java.util.concurrent.TimeUnit
import kotlin.math.absoluteValue

data class UiRoom(
    val id: String,
    val name: String,
    val preview: String,
    val actor: String,
    val unread: Int,
    val identity: Int,
    val kind: RoomKind,
    val groupName: String? = null,
    val peerId: String? = null,
    val memberCount: Int = 0,
    val archivedMemberCount: Int = 0,
)

enum class RoomKind { Group, Dm }

data class UiMessage(
    val eventId: Long,
    val author: String,
    val body: String,
    val time: String,
    val self: Boolean,
    val identity: Int,
    val roomId: String,
    val parentEventId: Long? = null,
    val replyToEventId: Long? = null,
    val replyCount: Int = 0,
    val deliveredCount: Int = 0,
    val readCount: Int = 0,
)

data class UiAgent(
    val peerId: String,
    val handle: String,
    val model: String,
    val status: String,
    val online: Boolean,
    val identity: Int,
    val archived: Boolean,
    val role: String,
    val presence: String,
    val profileName: String? = null,
    val thinking: String? = null,
    val cwd: String? = null,
    val gitBranch: String? = null,
    val hostTool: String? = null,
    val hostSessionId: String? = null,
    val launchState: String? = null,
    val launchFailure: String? = null,
    val archivedReason: String? = null,
)

data class UiActivityItem(
    val eventId: Long,
    val room: String,
    val actor: String,
    val summary: String,
    val time: String,
    val latest: Boolean,
    val awaiting: Boolean,
    val identity: Int,
)

data class LaunchProfile(val name: String, val tool: String)

data class SpawnDraft(
    val name: String = "",
    val group: String = "",
    val repo: String = "",
    val tool: String = "claude",
    val profile: String = "",
    val model: String = "",
    val thinking: String = "",
)

data class SynchronizeUiState(
    val baseUrl: String = "http://127.0.0.1:57430",
    val peerId: String? = null,
    val rooms: List<UiRoom> = emptyList(),
    val messages: Map<String, List<UiMessage>> = emptyMap(),
    val agents: List<UiAgent> = emptyList(),
    val activity: List<UiActivityItem> = emptyList(),
    val awaitingCount: Int = 0,
    val launchTools: List<String> = emptyList(),
    val launchProfiles: List<LaunchProfile> = emptyList(),
    val activityAwaitingOnly: Boolean = false,
    val loading: Boolean = true,
    val status: String = "connecting",
    val error: String? = null,
    val spawnDraft: SpawnDraft = SpawnDraft(),
    val lastAction: String? = null,
)

class SynchronizeRepository(
    private val baseUrl: String = "http://127.0.0.1:57430",
) {
    private val json = Json { ignoreUnknownKeys = true }
    private val mediaType = "application/json; charset=utf-8".toMediaType()
    private val client = OkHttpClient.Builder()
        .connectTimeout(3, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .build()
    private val eventSourceFactory = EventSources.createFactory(client)
    private var eventSource: EventSource? = null
    private var peerId: String? = null
    private var stateCursor: Long = 0
    private var refreshJob: Job? = null

    private val _state = MutableStateFlow(SynchronizeUiState(baseUrl = baseUrl))
    val state: StateFlow<SynchronizeUiState> = _state

    suspend fun run() = coroutineScope {
        refreshJob?.cancel()
        try {
            ensurePeer()
            refreshAll()
            openEvents(this)
            while (isActive) {
                delay(2_000)
                refreshAll()
            }
        } catch (error: Throwable) {
            _state.update {
                it.copy(
                    loading = false,
                    status = "offline",
                    error = error.message ?: error::class.java.simpleName,
                )
            }
            while (isActive) {
                delay(2_000)
                try {
                    ensurePeer()
                    refreshAll()
                    openEvents(this)
                    _state.update { it.copy(status = "live", error = null) }
                } catch (retryError: Throwable) {
                    _state.update {
                        it.copy(
                            loading = false,
                            status = "retrying",
                            error = retryError.message ?: retryError::class.java.simpleName,
                        )
                    }
                }
            }
        } finally {
            eventSource?.cancel()
        }
    }

    suspend fun refreshRoom(roomId: String) {
        val id = peerId ?: return
        val payload = getJson("/web/state?room=${encode(roomId)}&since=0&limit=500&peer_id=${encode(id)}")
        val messages = mapMessages(payload, id, roomId)
        _state.update { it.copy(messages = it.messages + (roomId to messages), error = null) }
    }

    suspend fun sendMessage(room: UiRoom, text: String) {
        sendMessage(room, text, null)
    }

    suspend fun sendMessage(room: UiRoom, text: String, inReplyTo: Long?) {
        val id = peerId ?: return
        val trimmed = text.trim()
        if (trimmed.isEmpty()) return
        when (room.kind) {
            RoomKind.Group -> postJson(
                "/groups/${encode(room.groupName ?: room.name)}/messages",
                buildJsonObject {
                    put("sender_peer_id", id)
                    put("message", trimmed)
                    if (inReplyTo != null) put("in_reply_to", inReplyTo)
                    putJsonArray("skill_directives") {}
                },
            )
            RoomKind.Dm -> postJson(
                "/dm",
                buildJsonObject {
                    put("sender_peer_id", id)
                    put("recipient_peer_id", room.peerId.orEmpty())
                    put("message", trimmed)
                },
            )
        }
        refreshAll()
        refreshRoom(room.id)
    }

    suspend fun setActivityAwaitingOnly(awaitingOnly: Boolean) {
        _state.update { it.copy(activityAwaitingOnly = awaitingOnly) }
        refreshActivity()
    }

    suspend fun ackActivity(eventId: Long? = null) {
        val id = peerId ?: return
        val body = if (eventId == null) {
            buildJsonObject {}
        } else {
            buildJsonObject { putJsonArray("event_ids") { add(JsonPrimitive(eventId)) } }
        }
        postJson("/peers/${encode(id)}/inbox/ack", body)
        refreshActivity()
    }

    suspend fun archivePeer(peerId: String) {
        postJson("/archive/session", buildJsonObject {
            put("peer_id", peerId)
            put("reason", "archived from Android")
        })
        _state.update { it.copy(lastAction = "archived session") }
        refreshAll()
    }

    suspend fun resumePeer(peerId: String) {
        postJson("/resume/session", buildJsonObject {
            put("peer_id", peerId)
            put("force", false)
        })
        _state.update { it.copy(lastAction = "resume requested") }
        refreshAll()
    }

    suspend fun archiveGroup(room: UiRoom) {
        val group = room.groupName ?: return
        postJson("/archive/group", buildJsonObject {
            put("group", group)
            put("reason", "archived from Android")
        })
        _state.update { it.copy(lastAction = "archived group") }
        refreshAll()
    }

    suspend fun resumeGroup(room: UiRoom) {
        val group = room.groupName ?: return
        postJson("/resume/group", buildJsonObject {
            put("group", group)
            put("force", false)
        })
        _state.update { it.copy(lastAction = "resume group requested") }
        refreshAll()
    }

    fun updateSpawnDraft(update: (SpawnDraft) -> SpawnDraft) {
        _state.update { it.copy(spawnDraft = update(it.spawnDraft)) }
    }

    suspend fun spawnAgent() {
        val draft = state.value.spawnDraft
        val group = draft.group.ifBlank { state.value.rooms.firstOrNull { it.kind == RoomKind.Group }?.name }.orEmpty()
        val name = draft.name.ifBlank { "android-agent-${System.currentTimeMillis().toString().takeLast(4)}" }
        postJson("/agent-sessions/launch", buildJsonObject {
            put("tool", draft.tool.ifBlank { "claude" })
            if (draft.profile.isNotBlank()) put("profile_name", draft.profile)
            put("name", name)
            if (draft.repo.isNotBlank()) put("repo", draft.repo)
            if (group.isNotBlank()) put("group", group)
            if (draft.model.isNotBlank()) put("model", draft.model)
            if (draft.thinking.isNotBlank()) put("thinking", draft.thinking)
        })
        _state.update { it.copy(spawnDraft = draft.copy(name = ""), status = "spawn requested", lastAction = "spawn requested") }
        refreshAll()
    }

    private suspend fun ensurePeer(): String {
        peerId?.let { return it }
        val response = postJson("/web/session", buildJsonObject {})
        val id = response.obj("peer")?.str("peer_id") ?: error("daemon did not return peer_id")
        peerId = id
        _state.update { it.copy(peerId = id, status = "registered") }
        return id
    }

    private suspend fun refreshAll() {
        val id = ensurePeer()
        val payload = getJson("/web/state?limit=500&peer_id=${encode(id)}")
        stateCursor = payload.long("cursor") ?: stateCursor
        val mapped = mapSummary(payload, id)
        _state.update {
            it.copy(
                peerId = id,
                rooms = mapped.rooms,
                agents = mapped.agents,
                launchTools = mapped.launchTools,
                launchProfiles = mapped.launchProfiles,
                loading = false,
                status = "live",
                error = null,
            )
        }
        refreshActivity()
    }

    private suspend fun refreshActivity() {
        val id = peerId ?: return
        val filter = if (state.value.activityAwaitingOnly) "&filter=awaiting" else ""
        val payload = getJson("/activity/${encode(id)}?limit=200$filter")
        val peers = payload.arr("peers").associateBy { it.str("peer_id").orEmpty() }
        val events = payload.arr("events")
        val mapped = events.mapIndexed { index, event ->
            val actorId = event.str("sender_peer_id")
            val actor = actorId?.let { peers[it]?.str("session_name") } ?: actorId ?: "system"
            UiActivityItem(
                eventId = event.long("event_id") ?: index.toLong(),
                room = event.int("group_id")?.let { "group:$it" } ?: event.str("recipient_peer_id")?.let { "dm" } ?: "system",
                actor = actor,
                summary = event.str("body")?.ifBlank { null } ?: event.str("type").orEmpty().replace('_', ' '),
                time = shortTime(event.str("created_at")),
                latest = index == 0,
                awaiting = event.bool("awaiting"),
                identity = stableIdentity(actorId ?: actor),
            )
        }
        _state.update {
            it.copy(
                activity = mapped,
                awaitingCount = payload.int("awaiting_count") ?: mapped.count { item -> item.awaiting },
                error = null,
            )
        }
    }

    private fun openEvents(scope: CoroutineScope) {
        eventSource?.cancel()
        val request = Request.Builder()
            .url("$baseUrl/web/events")
            .header("Accept", "text/event-stream")
            .build()
        eventSource = eventSourceFactory.newEventSource(request, object : EventSourceListener() {
            override fun onEvent(eventSource: EventSource, id: String?, type: String?, data: String) {
                refreshJob?.cancel()
                refreshJob = scope.launch {
                    delay(180)
                    runCatching { refreshAll() }
                }
            }

            override fun onFailure(eventSource: EventSource, t: Throwable?, response: Response?) {
                _state.update { it.copy(status = "polling", error = t?.message) }
            }
        })
    }

    internal fun mapSummary(payload: JsonObject, me: String): SummaryMapping {
        val peers = payload.arr("peers").associateBy { it.str("peer_id").orEmpty() }
        val summaries = payload.arr("room_summaries").associateBy { it.int("group_id") }
        val groups = payload.arr("groups")
        val memberships = payload.arr("memberships")
        val rooms = groups.map { group ->
            val groupId = group.int("group_id") ?: 0
            val summary = summaries[groupId]
            val members = memberships.filter { it.int("group_id") == groupId }
            val activeMembers = members.count { it.bool("active") }
            val archivedMembers = members.count { it.str("member_state") == "archived" }
            UiRoom(
                id = "group:$groupId",
                name = group.str("name") ?: "group-$groupId",
                preview = summary?.str("last_preview") ?: group.str("description") ?: "no activity yet",
                actor = summary?.str("last_actor") ?: "$activeMembers members",
                unread = 0,
                identity = stableIdentity("group:$groupId"),
                kind = RoomKind.Group,
                groupName = group.str("name"),
                memberCount = activeMembers,
                archivedMemberCount = archivedMembers,
            )
        }
        val dmRooms = peers.values
            .filter { it.str("peer_id") != me && it.str("lifecycle_state") != "archived" }
            .map { peer ->
                val id = peer.str("peer_id").orEmpty()
                UiRoom(
                    id = "dm:$id",
                    name = peer.str("session_name") ?: id.take(10),
                    preview = peer.str("purpose") ?: "open direct message",
                    actor = peer.str("presence") ?: if (peer.bool("online")) "online" else "offline",
                    unread = 0,
                    identity = stableIdentity(id),
                    kind = RoomKind.Dm,
                    peerId = id,
                )
            }
        val runtimeByPeer = payload.arr("agent_runtime_details").associateBy { it.str("peer_id").orEmpty() }
        val agents = peers.values.map { peer ->
            val id = peer.str("peer_id").orEmpty()
            val runtime = runtimeByPeer[id]
            val presence = peer.str("presence") ?: if (peer.bool("online")) "online" else "offline"
            val archived = peer.str("lifecycle_state") == "archived"
            UiAgent(
                peerId = id,
                handle = if (id == me) "you" else peer.str("session_name") ?: id.take(10),
                model = runtime?.str("model") ?: runtime?.str("tool") ?: peer.str("tool") ?: "unknown",
                status = runtime?.str("launch_state") ?: peer.str("purpose") ?: presence,
                online = presence != "offline" && !archived,
                identity = stableIdentity(id),
                archived = archived,
                role = peer.str("tool") ?: "peer",
                presence = presence,
                profileName = runtime?.str("profile_name"),
                thinking = runtime?.str("thinking"),
                cwd = runtime?.str("cwd"),
                gitBranch = runtime?.str("git_branch"),
                hostTool = runtime?.str("host_tool"),
                hostSessionId = runtime?.str("host_session_id"),
                launchState = runtime?.str("launch_state"),
                launchFailure = runtime?.str("failure_message") ?: runtime?.str("failure_code"),
                archivedReason = peer.str("archived_reason"),
            )
        }.sortedWith(compareByDescending<UiAgent> { it.online }.thenBy { it.archived }.thenBy { it.handle })
        val launchTools = payload.obj("launch_tools")?.entries
            ?.filter { (_, value) -> value.jsonObject.bool("available") }
            ?.map { it.key }
            ?: emptyList()
        val launchProfiles = payload.arr("launch_profiles").mapNotNull { profile ->
            val name = profile.str("name") ?: profile.str("profile_name") ?: return@mapNotNull null
            LaunchProfile(name = name, tool = profile.str("tool") ?: "")
        }
        return SummaryMapping(rooms + dmRooms, agents, launchTools.ifEmpty { listOf("claude") }, launchProfiles)
    }

    internal fun mapMessages(payload: JsonObject, me: String, roomId: String): List<UiMessage> {
        val peers = payload.arr("peers").associateBy { it.str("peer_id").orEmpty() }
        val events = payload.arr("events")
        return events.mapNotNull { event ->
            val sender = event.str("sender_peer_id")
            val isGroup = roomId.startsWith("group:") && event.str("type") == "group_message"
            val isDm = roomId.startsWith("dm:") && event.str("type") == "dm"
            if (!isGroup && !isDm) return@mapNotNull null
            UiMessage(
                eventId = event.long("event_id") ?: return@mapNotNull null,
                author = if (sender == me) "you" else sender?.let { peers[it]?.str("session_name") } ?: sender ?: "system",
                body = event.str("body").orEmpty(),
                time = shortTime(event.str("created_at")),
                self = sender == me,
                identity = stableIdentity(sender ?: "system"),
                roomId = roomId,
                parentEventId = event.long("parent_event_id"),
                replyToEventId = event.long("reply_to_event_id"),
                replyCount = event.int("reply_count") ?: 0,
                deliveredCount = event.int("delivered_count") ?: 0,
                readCount = event.int("read_count") ?: 0,
            )
        }.sortedBy { it.eventId }
    }

    private suspend fun getJson(path: String): JsonObject = requestJson("GET", path)

    private suspend fun postJson(path: String, body: JsonObject): JsonObject =
        requestJson("POST", path, body)

    private suspend fun requestJson(method: String, path: String, body: JsonObject? = null): JsonObject = withContext(Dispatchers.IO) {
        val requestBody = body?.toString()?.toRequestBody(mediaType)
        val request = Request.Builder()
            .url("$baseUrl$path")
            .method(method, requestBody)
            .build()
        client.newCall(request).execute().use { response ->
            val responseBody = response.body?.string().orEmpty()
            if (!response.isSuccessful) throw IOException("HTTP ${response.code}: ${responseBody.ifBlank { response.message }}")
            json.parseToJsonElement(responseBody.ifBlank { "{}" }).jsonObject
        }
    }

    private fun encode(value: String): String = URLEncoder.encode(value, "UTF-8")
}

internal data class SummaryMapping(
    val rooms: List<UiRoom>,
    val agents: List<UiAgent>,
    val launchTools: List<String>,
    val launchProfiles: List<LaunchProfile>,
)

private fun JsonObject.obj(name: String): JsonObject? = this[name]?.takeUnless { it is JsonNull }?.jsonObject
private fun JsonObject.arr(name: String): List<JsonObject> =
    (this[name] as? JsonArray)?.mapNotNull { it as? JsonObject } ?: emptyList()
private fun JsonObject.str(name: String): String? = this[name]?.jsonPrimitive?.contentOrNull
private fun JsonObject.int(name: String): Int? = this[name]?.jsonPrimitive?.intOrNull
private fun JsonObject.long(name: String): Long? = this[name]?.jsonPrimitive?.longOrNull
private fun JsonObject.bool(name: String): Boolean =
    this[name]?.jsonPrimitive?.booleanOrNull ?: this[name]?.jsonPrimitive?.intOrNull?.let { it != 0 } ?: false

private fun stableIdentity(key: String): Int = key.hashCode().absoluteValue % 8

private fun shortTime(value: String?): String {
    if (value.isNullOrBlank()) return "now"
    return value.substringAfter('T', value).take(5).ifBlank { value.take(10) }
}
