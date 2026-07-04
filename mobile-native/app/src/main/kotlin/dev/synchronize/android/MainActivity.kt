package dev.synchronize.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.outlined.Bolt
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.SmartToy
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.synchronize.android.ui.GlassTheme
import dev.synchronize.android.ui.JetBrainsMono
import dev.synchronize.android.ui.LocalGlassTokens

// ── Mock data (Phase 1 scaffold — daemon wiring is a later phase) ────────────
data class Room(val name: String, val preview: String, val actor: String, val unread: Int, val identity: Int)
data class Message(val author: String, val body: String, val time: String, val self: Boolean, val identity: Int)
data class Peer(val handle: String, val model: String, val status: String, val online: Boolean, val identity: Int)
data class ActivityItem(val room: String, val actor: String, val summary: String, val time: String, val latest: Boolean, val identity: Int)

private val mockRooms = listOf(
    Room("ops-room", "codex-rescue: build green after wrapper fix", "codex-rescue", 3, 2),
    Room("design-sync", "you: pushing glass tokens to android", "you", 0, 1),
    Room("android-app", "claude-fable: compact shell contract locked", "claude-fable", 5, 3),
    Room("session-logs", "pi-parser: 41 sessions indexed", "pi-parser", 0, 7),
    Room("daemon-core", "codex: provenance events flushed", "codex", 1, 5),
)

private val mockMessages = listOf(
    Message("claude-fable", "Compact shell contract locked: bottom nav, Chats overlay, thread as pushed panel.", "09:12", false, 3),
    Message("you", "Binding the glass tokens into the M3 color scheme now.", "09:14", true, 2),
    Message("codex-rescue", "Wrapper reused from the Capacitor project — gradle 8.14.3, AGP 8.13.", "09:15", false, 0),
    Message("you", "First APK target: rooms list → conversation with the accent-washed self bubbles.", "09:17", true, 2),
    Message("claude-fable", "Identity slots stay muted — no neon avatars on dark glass.", "09:18", false, 3),
)

private val mockPeers = listOf(
    Peer("claude-fable", "fable-5", "reviewing shell contract", true, 3),
    Peer("codex-rescue", "gpt-5.4", "idle · awaiting build", true, 0),
    Peer("pi-parser", "pi-2", "indexing session logs", true, 7),
    Peer("codex", "gpt-5.4", "offline", false, 5),
)

private val mockActivity = listOf(
    ActivityItem("android-app", "claude-fable", "locked compact shell contract", "2m", true, 3),
    ActivityItem("ops-room", "codex-rescue", "reported build green", "11m", false, 0),
    ActivityItem("session-logs", "pi-parser", "indexed 41 sessions", "26m", false, 7),
    ActivityItem("daemon-core", "codex", "flushed provenance events", "1h", false, 5),
)

// ── Shell ────────────────────────────────────────────────────────────────────
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent { GlassTheme { SynchronizeApp() } }
    }
}

private enum class Tab(val label: String) { Chat("CHAT"), Activity("ACTIVITY"), Agents("AGENTS") }

@Composable
fun SynchronizeApp() {
    var tab by rememberSaveable { mutableStateOf(Tab.Chat) }
    var openRoom by rememberSaveable { mutableStateOf<String?>(null) }
    val inConversation = tab == Tab.Chat && openRoom != null

    BackHandler(enabled = inConversation) { openRoom = null }

    Box(Modifier.fillMaxSize()) {
        MeshBackdrop()
        Scaffold(
            containerColor = Color.Transparent,
            bottomBar = {
                if (!inConversation) NavigationBar(containerColor = MaterialTheme.colorScheme.surfaceContainer) {
                    NavigationBarItem(tab == Tab.Chat, { tab = Tab.Chat; openRoom = null },
                        { Icon(Icons.Outlined.ChatBubbleOutline, null) }, label = { Text(Tab.Chat.label) })
                    NavigationBarItem(tab == Tab.Activity, { tab = Tab.Activity },
                        { Icon(Icons.Outlined.Bolt, null) }, label = { Text(Tab.Activity.label) })
                    NavigationBarItem(tab == Tab.Agents, { tab = Tab.Agents },
                        { Icon(Icons.Outlined.SmartToy, null) }, label = { Text(Tab.Agents.label) })
                }
            },
        ) { pad ->
            AnimatedContent(
                targetState = Triple(tab, openRoom, inConversation),
                transitionSpec = {
                    if (targetState.third != initialState.third) {
                        val dir = if (targetState.third) 1 else -1
                        (slideInHorizontally { it * dir } + fadeIn()) togetherWith
                            (slideOutHorizontally { -it * dir / 3 } + fadeOut())
                    } else fadeIn() togetherWith fadeOut()
                },
                label = "shell",
                modifier = Modifier.padding(pad),
            ) { (t, room, conv) ->
                when {
                    conv && room != null -> ConversationScreen(room) { openRoom = null }
                    t == Tab.Chat -> RoomsScreen { openRoom = it }
                    t == Tab.Activity -> ActivityScreen()
                    else -> AgentsScreen()
                }
            }
        }
    }
}

/** Fixed ambient mesh: self/accent + lilac + teal radials, screen-blended feel. */
@Composable
private fun MeshBackdrop() {
    val glass = LocalGlassTokens.current
    Box(
        Modifier
            .fillMaxSize()
            .background(glass.bg)
            .background(Brush.radialGradient(listOf(glass.accent.copy(alpha = 0.14f), Color.Transparent), center = Offset(150f, 300f), radius = 1200f))
            .background(Brush.radialGradient(listOf(Color(0xFF9D7CD8).copy(alpha = 0.10f), Color.Transparent), center = Offset(950f, 900f), radius = 1100f))
            .background(Brush.radialGradient(listOf(Color(0xFF4B8681).copy(alpha = 0.10f), Color.Transparent), center = Offset(400f, 2100f), radius = 1300f))
    )
}

@Composable
private fun IdentityAvatar(index: Int, label: String, size: Int = 40) {
    val slot = LocalGlassTokens.current.identity[index % 8]
    Box(
        Modifier.size(size.dp).clip(CircleShape).background(slot.bg),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label.take(2).uppercase(),
            color = Color(0xFFE7E9EA),
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.Bold,
        )
    }
}

// ── Rooms ────────────────────────────────────────────────────────────────────
@Composable
private fun RoomsScreen(onOpen: (String) -> Unit) {
    val glass = LocalGlassTokens.current
    Column(Modifier.fillMaxSize()) {
        Text(
            "Synchronize",
            style = MaterialTheme.typography.titleLarge,
            modifier = Modifier.padding(18.dp, 16.dp, 18.dp, 10.dp),
        )
        LazyColumn(Modifier.fillMaxSize()) {
            items(mockRooms) { room ->
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clickable { onOpen(room.name) }
                        .padding(horizontal = 18.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    IdentityAvatar(room.identity, room.name)
                    Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                        Text(room.name, style = MaterialTheme.typography.titleSmall, fontFamily = JetBrainsMono)
                        Text(
                            room.preview,
                            style = MaterialTheme.typography.bodyMedium,
                            color = glass.inkSoft,
                            maxLines = 1, overflow = TextOverflow.Ellipsis,
                        )
                    }
                    if (room.unread > 0) Box(
                        Modifier.clip(CircleShape).background(glass.accent).padding(horizontal = 7.dp, vertical = 2.dp),
                    ) { Text("${room.unread}", color = Color.White, style = MaterialTheme.typography.labelSmall) }
                }
                HorizontalDivider(color = glass.rule)
            }
        }
    }
}

// ── Conversation ─────────────────────────────────────────────────────────────
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ConversationScreen(room: String, onBack: () -> Unit) {
    val glass = LocalGlassTokens.current
    var draft by remember { mutableStateOf("") }
    Column(Modifier.fillMaxSize()) {
        TopAppBar(
            title = { Text(room, fontFamily = JetBrainsMono, style = MaterialTheme.typography.titleMedium) },
            navigationIcon = {
                IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
            },
            colors = TopAppBarDefaults.topAppBarColors(containerColor = Color.Transparent),
            // Scaffold padding already carries the status-bar inset; avoid double inset
            windowInsets = androidx.compose.foundation.layout.WindowInsets(0, 0, 0, 0),
        )
        LazyColumn(
            Modifier.weight(1f).fillMaxWidth(),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 14.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            items(mockMessages) { msg -> MessageBubble(msg) }
        }
        // Floating composer: rounded top corners, square bottom (glass contract)
        Surface(
            color = MaterialTheme.colorScheme.surfaceContainerHigh,
            shape = RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp),
        ) {
            Row(
                Modifier.fillMaxWidth().padding(10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                OutlinedTextField(
                    value = draft, onValueChange = { draft = it },
                    modifier = Modifier.weight(1f),
                    placeholder = { Text("Message $room", color = glass.inkFaint) },
                    shape = RoundedCornerShape(12.dp),
                    maxLines = 4,
                )
                IconButton(onClick = { draft = "" }, enabled = draft.isNotBlank()) {
                    Icon(Icons.AutoMirrored.Filled.Send, "Send", tint = if (draft.isBlank()) glass.inkFaint else glass.accent)
                }
            }
        }
    }
}

@Composable
private fun MessageBubble(msg: Message) {
    val glass = LocalGlassTokens.current
    // Self = faint accent wash over bubble (color-mix 11% equivalent), no shadow
    val fill = if (msg.self) glass.accent.copy(alpha = 0.11f).compositeOverBubble(glass.bubble) else glass.bubble
    Row(Modifier.fillMaxWidth(), horizontalArrangement = if (msg.self) Arrangement.End else Arrangement.Start) {
        if (!msg.self) {
            IdentityAvatar(msg.identity, msg.author, size = 30)
            Spacer(Modifier.width(8.dp))
        }
        Column(
            Modifier
                .widthIn(max = 300.dp)
                .clip(RoundedCornerShape(14.dp))
                .background(fill)
                .padding(horizontal = 12.dp, vertical = 8.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    msg.author,
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.Bold,
                    color = if (msg.self) glass.accent else glass.identity[msg.identity % 8].text,
                )
                Spacer(Modifier.width(8.dp))
                Text(msg.time, style = MaterialTheme.typography.labelSmall, color = glass.inkFaint, fontFamily = JetBrainsMono)
            }
            Spacer(Modifier.height(2.dp))
            Text(msg.body, style = MaterialTheme.typography.bodyLarge)
        }
    }
}

private fun Color.compositeOverBubble(bubble: Color): Color {
    val a = alpha
    return Color(
        red = red * a + bubble.red * (1 - a),
        green = green * a + bubble.green * (1 - a),
        blue = blue * a + bubble.blue * (1 - a),
    )
}

// ── Activity ─────────────────────────────────────────────────────────────────
@Composable
private fun ActivityScreen() {
    val glass = LocalGlassTokens.current
    Column(Modifier.fillMaxSize()) {
        Text("Activity", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(18.dp, 16.dp, 18.dp, 10.dp))
        LazyColumn(
            contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 14.dp),
            verticalArrangement = Arrangement.spacedBy(5.dp),
        ) {
            items(mockActivity) { item ->
                Surface(
                    color = if (item.latest) MaterialTheme.colorScheme.surfaceContainerHigh else MaterialTheme.colorScheme.surfaceContainer,
                    shape = RoundedCornerShape(10.dp),
                    border = androidx.compose.foundation.BorderStroke(1.dp, glass.rule),
                ) {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        if (item.latest) Box(Modifier.width(3.dp).height(56.dp).background(glass.identity[1].text))
                        Row(
                            Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            IdentityAvatar(item.identity, item.actor, size = 32)
                            Column(Modifier.weight(1f).padding(horizontal = 10.dp)) {
                                Text("${item.actor} · ${item.room}", style = MaterialTheme.typography.labelMedium, fontFamily = JetBrainsMono, color = glass.inkSoft)
                                Text(item.summary, style = MaterialTheme.typography.bodyMedium)
                            }
                            Text(item.time, style = MaterialTheme.typography.labelSmall, color = glass.inkFaint, fontFamily = JetBrainsMono)
                        }
                    }
                }
            }
        }
    }
}

// ── Agents roster ────────────────────────────────────────────────────────────
@Composable
private fun AgentsScreen() {
    val glass = LocalGlassTokens.current
    Column(Modifier.fillMaxSize()) {
        Text("Agents", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(18.dp, 16.dp, 18.dp, 10.dp))
        LazyColumn {
            items(mockPeers) { peer ->
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box {
                        IdentityAvatar(peer.identity, peer.handle)
                        Box(
                            Modifier
                                .align(Alignment.BottomEnd)
                                .size(11.dp)
                                .clip(CircleShape)
                                .background(if (peer.online) glass.success else glass.inkFaint),
                        )
                    }
                    Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                        Text(peer.handle, style = MaterialTheme.typography.titleSmall, fontFamily = JetBrainsMono)
                        Text(peer.status, style = MaterialTheme.typography.bodyMedium, color = glass.inkSoft)
                    }
                    Surface(
                        color = MaterialTheme.colorScheme.secondaryContainer,
                        shape = RoundedCornerShape(6.dp),
                    ) {
                        Text(
                            peer.model,
                            fontFamily = JetBrainsMono,
                            style = MaterialTheme.typography.labelSmall,
                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
                        )
                    }
                }
                HorizontalDivider(color = glass.rule)
            }
        }
    }
}
