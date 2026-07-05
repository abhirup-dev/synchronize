package dev.synchronize.android

import android.os.Bundle
import android.text.method.LinkMovementMethod
import android.view.ViewGroup
import android.widget.TextView
import android.graphics.Color as AndroidColor
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
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
import androidx.compose.material.icons.automirrored.outlined.Reply
import androidx.compose.material.icons.outlined.Archive
import androidx.compose.material.icons.outlined.Bolt
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.DoneAll
import androidx.compose.material.icons.outlined.Forum
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.SmartToy
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import dev.synchronize.android.data.RoomKind
import dev.synchronize.android.data.SpawnDraft
import dev.synchronize.android.data.SynchronizeRepository
import dev.synchronize.android.data.SynchronizeUiState
import dev.synchronize.android.data.UiActivityItem
import dev.synchronize.android.data.UiAgent
import dev.synchronize.android.data.UiMessage
import dev.synchronize.android.data.UiRoom
import dev.synchronize.android.ui.GlassTheme
import dev.synchronize.android.ui.JetBrainsMono
import dev.synchronize.android.ui.LocalGlassTokens
import io.noties.markwon.Markwon
import io.noties.markwon.ext.strikethrough.StrikethroughPlugin
import io.noties.markwon.ext.tables.TablePlugin
import io.noties.markwon.ext.tasklist.TaskListPlugin
import io.noties.markwon.html.HtmlPlugin
import io.noties.markwon.linkify.LinkifyPlugin
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.auto(AndroidColor.TRANSPARENT, AndroidColor.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.auto(AndroidColor.TRANSPARENT, AndroidColor.TRANSPARENT),
        )
        window.isNavigationBarContrastEnforced = false
        setContent { GlassTheme { SynchronizeApp() } }
    }
}

private enum class Tab(val label: String) { Chat("CHAT"), Activity("ACTIVITY"), Agents("AGENTS") }

@Composable
fun SynchronizeApp() {
    val repository = remember { SynchronizeRepository() }
    val state by repository.state.collectAsState()
    var tab by rememberSaveable { mutableStateOf(Tab.Chat) }
    var openRoomId by rememberSaveable { mutableStateOf<String?>(null) }
    var openThreadParentId by rememberSaveable { mutableStateOf<Long?>(null) }
    var openAgentId by rememberSaveable { mutableStateOf<String?>(null) }
    val openRoom = state.rooms.firstOrNull { it.id == openRoomId }
    val openAgent = state.agents.firstOrNull { it.peerId == openAgentId }
    val inConversation = tab == Tab.Chat && openRoom != null
    val inThread = inConversation && openThreadParentId != null
    val inAgentProfile = tab == Tab.Agents && openAgent != null

    LaunchedEffect(repository) { repository.run() }
    LaunchedEffect(openRoomId) {
        openRoomId?.let { repository.refreshRoom(it) }
    }
    BackHandler(enabled = inThread) { openThreadParentId = null }
    BackHandler(enabled = inConversation && !inThread) { openRoomId = null }
    BackHandler(enabled = inAgentProfile) { openAgentId = null }

    Box(Modifier.fillMaxSize()) {
        MeshBackdrop()
        Scaffold(
            containerColor = Color.Transparent,
            contentColor = MaterialTheme.colorScheme.onBackground,
            bottomBar = {
                if (!inConversation && !inAgentProfile) {
                    NavigationBar(containerColor = MaterialTheme.colorScheme.surfaceContainer.copy(alpha = 0.88f)) {
                        NavigationBarItem(tab == Tab.Chat, { tab = Tab.Chat; openRoomId = null; openThreadParentId = null; openAgentId = null },
                            { Icon(Icons.Outlined.ChatBubbleOutline, null) }, label = { Text(Tab.Chat.label) })
                        NavigationBarItem(tab == Tab.Activity, { tab = Tab.Activity; openAgentId = null },
                            { Icon(Icons.Outlined.Bolt, null) }, label = { Text(Tab.Activity.label) })
                        NavigationBarItem(tab == Tab.Agents, { tab = Tab.Agents; openAgentId = null },
                            { Icon(Icons.Outlined.SmartToy, null) }, label = { Text(Tab.Agents.label) })
                    }
                }
            },
        ) { pad ->
            AnimatedContent(
                targetState = listOf(tab.name, openRoomId.orEmpty(), openThreadParentId?.toString().orEmpty(), openAgentId.orEmpty()),
                transitionSpec = {
                    val targetDetail = targetState.drop(1).any { it.isNotEmpty() }
                    val initialDetail = initialState.drop(1).any { it.isNotEmpty() }
                    if (targetDetail != initialDetail) {
                        val dir = if (targetDetail) 1 else -1
                        (slideInHorizontally { it * dir } + fadeIn()) togetherWith
                            (slideOutHorizontally { -it * dir / 3 } + fadeOut())
                    } else fadeIn() togetherWith fadeOut()
                },
                label = "shell",
                modifier = Modifier.padding(pad),
            ) {
                when {
                    inThread -> {
                        val room = openRoom ?: return@AnimatedContent
                        val parentId = openThreadParentId ?: return@AnimatedContent
                        ThreadScreen(room, state.messages[room.id].orEmpty(), parentId, repository) { openThreadParentId = null }
                    }
                    inConversation -> {
                        val room = openRoom ?: return@AnimatedContent
                        ConversationScreen(room, state.messages[room.id].orEmpty(), repository, onOpenThread = { openThreadParentId = it }) { openRoomId = null }
                    }
                    inAgentProfile -> {
                        val agent = openAgent ?: return@AnimatedContent
                        AgentProfileScreen(agent, repository) { openAgentId = null }
                    }
                    tab == Tab.Chat -> RoomsScreen(state) { openRoomId = it.id }
                    tab == Tab.Activity -> ActivityScreen(state, repository)
                    else -> AgentsScreen(state, repository) { openAgentId = it.peerId }
                }
            }
        }
    }
}

@Composable
private fun MeshBackdrop() {
    val glass = LocalGlassTokens.current
    val wash = if (glass.isDark) listOf(Color(0xFF000000), Color(0xFF06080A))
    else listOf(Color(0xFFFFFFFF), Color(0xFFEEF1F4))
    val mesh = if (glass.isDark) 0.26f else 0.16f
    Box(
        Modifier
            .fillMaxSize()
            .background(Brush.verticalGradient(wash))
            .background(Brush.radialGradient(listOf(glass.accent.copy(alpha = mesh * 0.6f), Color.Transparent), center = Offset(150f, 300f), radius = 1200f))
            .background(Brush.radialGradient(listOf(Color(0xFF9D7CD8).copy(alpha = mesh * 0.45f), Color.Transparent), center = Offset(950f, 900f), radius = 1100f))
            .background(Brush.radialGradient(listOf(Color(0xFF4B8681).copy(alpha = mesh * 0.45f), Color.Transparent), center = Offset(400f, 2100f), radius = 1300f))
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
            color = slot.fg,
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.Bold,
        )
    }
}

@Composable
private fun StatusStrip(state: SynchronizeUiState) {
    val glass = LocalGlassTokens.current
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        AssistChip(onClick = {}, label = { Text(state.status, fontFamily = JetBrainsMono) })
        Text(
            state.peerId ?: state.baseUrl,
            color = glass.inkSoft,
            style = MaterialTheme.typography.labelSmall,
            fontFamily = JetBrainsMono,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
    }
    state.error?.let {
        Text(
            it,
            color = glass.danger,
            style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.padding(horizontal = 18.dp, vertical = 2.dp),
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
    }
    state.lastAction?.let {
        Text(
            it,
            color = glass.inkSoft,
            style = MaterialTheme.typography.labelSmall,
            modifier = Modifier.padding(horizontal = 18.dp, vertical = 2.dp),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun RoomsScreen(state: SynchronizeUiState, onOpen: (UiRoom) -> Unit) {
    val glass = LocalGlassTokens.current
    Column(Modifier.fillMaxSize()) {
        Text(
            "Synchronize",
            style = MaterialTheme.typography.titleLarge,
            modifier = Modifier.padding(18.dp, 16.dp, 18.dp, 2.dp),
        )
        StatusStrip(state)
        LazyColumn(Modifier.fillMaxSize()) {
            if (state.rooms.isEmpty()) item {
                EmptyState(if (state.loading) "Connecting to daemon..." else "No rooms found")
            }
            items(state.rooms, key = { it.id }) { room ->
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clickable { onOpen(room) }
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
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    Text(room.actor, color = glass.inkFaint, style = MaterialTheme.typography.labelSmall, fontFamily = JetBrainsMono)
                }
                HorizontalDivider(color = glass.rule)
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ConversationScreen(
    room: UiRoom,
    messages: List<UiMessage>,
    repository: SynchronizeRepository,
    onOpenThread: (Long) -> Unit,
    onBack: () -> Unit,
) {
    val glass = LocalGlassTokens.current
    val scope = rememberCoroutineScope()
    var draft by rememberSaveable(room.id) { mutableStateOf("") }
    var menuOpen by remember { mutableStateOf(false) }
    val mainMessages = remember(messages) {
        if (room.kind == RoomKind.Group) messages.filter { it.parentEventId == null } else messages
    }
    Column(Modifier.fillMaxSize()) {
        TopAppBar(
            title = {
                Column {
                    Text(room.name, fontFamily = JetBrainsMono, style = MaterialTheme.typography.titleMedium)
                    Text(room.preview, color = glass.inkSoft, style = MaterialTheme.typography.labelSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            },
            navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
            actions = {
                IconButton(onClick = { scope.launch { repository.refreshRoom(room.id) } }) { Icon(Icons.Outlined.Refresh, "Refresh") }
                if (room.kind == RoomKind.Group) {
                    Box {
                        IconButton(onClick = { menuOpen = true }) { Icon(Icons.Outlined.MoreVert, "Room actions") }
                        DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                            DropdownMenuItem(
                                text = { Text("Archive group") },
                                leadingIcon = { Icon(Icons.Outlined.Archive, null) },
                                onClick = {
                                    menuOpen = false
                                    scope.launch { repository.archiveGroup(room) }
                                },
                            )
                            DropdownMenuItem(
                                text = { Text("Resume group") },
                                leadingIcon = { Icon(Icons.Outlined.PlayArrow, null) },
                                onClick = {
                                    menuOpen = false
                                    scope.launch { repository.resumeGroup(room) }
                                },
                            )
                        }
                    }
                }
            },
            colors = TopAppBarDefaults.topAppBarColors(containerColor = Color.Transparent),
            windowInsets = WindowInsets(0, 0, 0, 0),
        )
        LazyColumn(
            Modifier.weight(1f).fillMaxWidth(),
            contentPadding = PaddingValues(horizontal = 14.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            if (mainMessages.isEmpty()) item { EmptyState("No messages loaded") }
            items(mainMessages, key = { it.eventId }) { msg ->
                MessageBubble(
                    msg = msg,
                    canThread = room.kind == RoomKind.Group,
                    onOpenThread = { onOpenThread(msg.eventId) },
                )
            }
        }
        Surface(
            color = MaterialTheme.colorScheme.surfaceContainerHigh.copy(alpha = 0.92f),
            shape = RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp),
        ) {
            Row(
                Modifier.fillMaxWidth().imePadding().padding(10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                OutlinedTextField(
                    value = draft,
                    onValueChange = { draft = it },
                    modifier = Modifier.weight(1f),
                    placeholder = { Text("Message ${room.name}", color = glass.inkFaint) },
                    shape = RoundedCornerShape(12.dp),
                    maxLines = 4,
                )
                IconButton(
                    onClick = {
                        val text = draft
                        draft = ""
                        scope.launch { repository.sendMessage(room, text) }
                    },
                    enabled = draft.isNotBlank(),
                ) {
                    Icon(Icons.AutoMirrored.Filled.Send, "Send", tint = if (draft.isBlank()) glass.inkFaint else glass.accent)
                }
            }
        }
    }
}

@Composable
private fun MessageBubble(msg: UiMessage, canThread: Boolean, onOpenThread: (() -> Unit)? = null) {
    val glass = LocalGlassTokens.current
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
            MarkdownBody(msg.body)
            if (canThread) {
                Row(
                    modifier = Modifier.padding(top = 6.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    TextButton(onClick = { onOpenThread?.invoke() }, contentPadding = PaddingValues(horizontal = 6.dp, vertical = 0.dp)) {
                        Icon(Icons.Outlined.Forum, null, modifier = Modifier.size(15.dp))
                        Spacer(Modifier.width(4.dp))
                        Text(if (msg.replyCount > 0) "${msg.replyCount} replies" else "Thread")
                    }
                    if (msg.self && (msg.deliveredCount > 0 || msg.readCount > 0)) {
                        Text(
                            if (msg.readCount > 0) "read ${msg.readCount}" else "delivered ${msg.deliveredCount}",
                            color = glass.inkFaint,
                            style = MaterialTheme.typography.labelSmall,
                            fontFamily = JetBrainsMono,
                        )
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ThreadScreen(room: UiRoom, messages: List<UiMessage>, parentId: Long, repository: SynchronizeRepository, onBack: () -> Unit) {
    val glass = LocalGlassTokens.current
    val scope = rememberCoroutineScope()
    val parent = messages.firstOrNull { it.eventId == parentId }
    val replies = messages.filter { it.parentEventId == parentId }
    var draft by rememberSaveable(room.id, parentId) { mutableStateOf("") }
    Column(Modifier.fillMaxSize()) {
        TopAppBar(
            title = {
                Column {
                    Text("Thread", style = MaterialTheme.typography.titleMedium)
                    Text(room.name, fontFamily = JetBrainsMono, style = MaterialTheme.typography.labelSmall, color = glass.inkSoft)
                }
            },
            navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
            actions = { IconButton(onClick = { scope.launch { repository.refreshRoom(room.id) } }) { Icon(Icons.Outlined.Refresh, "Refresh") } },
            colors = TopAppBarDefaults.topAppBarColors(containerColor = Color.Transparent),
            windowInsets = WindowInsets(0, 0, 0, 0),
        )
        LazyColumn(
            Modifier.weight(1f).fillMaxWidth(),
            contentPadding = PaddingValues(horizontal = 14.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            item {
                Surface(
                    color = MaterialTheme.colorScheme.surfaceContainerHigh.copy(alpha = 0.84f),
                    shape = RoundedCornerShape(14.dp),
                    border = BorderStroke(1.dp, glass.rule),
                ) {
                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(parent?.author ?: "message", fontFamily = JetBrainsMono, style = MaterialTheme.typography.labelMedium, color = glass.inkSoft)
                        MarkdownBody(parent?.body ?: "Parent message not loaded")
                    }
                }
            }
            if (replies.isEmpty()) item { EmptyState("No replies yet") }
            items(replies, key = { it.eventId }) { reply -> MessageBubble(reply, canThread = false) }
        }
        Surface(
            color = MaterialTheme.colorScheme.surfaceContainerHigh.copy(alpha = 0.92f),
            shape = RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp),
        ) {
            Row(Modifier.fillMaxWidth().imePadding().padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    value = draft,
                    onValueChange = { draft = it },
                    modifier = Modifier.weight(1f),
                    placeholder = { Text("Reply in thread", color = glass.inkFaint) },
                    shape = RoundedCornerShape(12.dp),
                    maxLines = 4,
                )
                IconButton(
                    onClick = {
                        val text = draft
                        draft = ""
                        scope.launch { repository.sendMessage(room, text, parentId) }
                    },
                    enabled = draft.isNotBlank(),
                ) {
                    Icon(Icons.AutoMirrored.Outlined.Reply, "Reply", tint = if (draft.isBlank()) glass.inkFaint else glass.accent)
                }
            }
        }
    }
}

private fun Color.compositeOverBubble(bubble: Color): Color {
    val a = alpha
    return Color(red = red * a + bubble.red * (1 - a), green = green * a + bubble.green * (1 - a), blue = blue * a + bubble.blue * (1 - a))
}

@Composable
private fun MarkdownBody(markdown: String, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val glass = LocalGlassTokens.current
    val markwon = remember(context) {
        Markwon.builder(context)
            .usePlugin(HtmlPlugin.create())
            .usePlugin(LinkifyPlugin.create())
            .usePlugin(StrikethroughPlugin.create())
            .usePlugin(TablePlugin.create(context))
            .usePlugin(TaskListPlugin.create(context))
            .build()
    }
    AndroidView(
        modifier = modifier.fillMaxWidth(),
        factory = { viewContext ->
            TextView(viewContext).apply {
                layoutParams = ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                )
                setBackgroundColor(AndroidColor.TRANSPARENT)
                includeFontPadding = false
                textSize = 16f
                setLineSpacing(0f, 1.08f)
                movementMethod = LinkMovementMethod.getInstance()
            }
        },
        update = { textView ->
            textView.setTextColor(glass.ink.toArgb())
            textView.setLinkTextColor(glass.accent.toArgb())
            textView.highlightColor = glass.accent.copy(alpha = 0.18f).toArgb()
            markwon.setMarkdown(textView, markdown.ifBlank { " " })
        },
    )
}

@Composable
private fun ActivityScreen(state: SynchronizeUiState, repository: SynchronizeRepository) {
    val glass = LocalGlassTokens.current
    val scope = rememberCoroutineScope()
    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier.fillMaxWidth().padding(18.dp, 16.dp, 18.dp, 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("Activity", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
            AssistChip(onClick = {}, label = { Text("${state.awaitingCount} awaiting", fontFamily = JetBrainsMono) })
        }
        Row(Modifier.padding(horizontal = 14.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(
                selected = !state.activityAwaitingOnly,
                onClick = { scope.launch { repository.setActivityAwaitingOnly(false) } },
                label = { Text("All") },
            )
            FilterChip(
                selected = state.activityAwaitingOnly,
                onClick = { scope.launch { repository.setActivityAwaitingOnly(true) } },
                label = { Text("Awaiting") },
            )
            OutlinedButton(onClick = { scope.launch { repository.ackActivity() } }) {
                Icon(Icons.Outlined.DoneAll, null)
                Spacer(Modifier.width(6.dp))
                Text("Ack all")
            }
        }
        LazyColumn(
            contentPadding = PaddingValues(horizontal = 14.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(5.dp),
        ) {
            if (state.activity.isEmpty()) item { EmptyState("No activity") }
            items(state.activity, key = { it.eventId }) { item ->
                ActivityRow(item) { scope.launch { repository.ackActivity(item.eventId) } }
            }
        }
    }
}

@Composable
private fun ActivityRow(item: UiActivityItem, onAck: () -> Unit) {
    val glass = LocalGlassTokens.current
    Surface(
        color = if (item.latest) MaterialTheme.colorScheme.surfaceContainerHigh else MaterialTheme.colorScheme.surfaceContainer,
        shape = RoundedCornerShape(10.dp),
        border = BorderStroke(1.dp, glass.rule),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            if (item.latest) Box(Modifier.width(3.dp).height(64.dp).background(glass.identity[1].text))
            Row(Modifier.padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                IdentityAvatar(item.identity, item.actor, size = 32)
                Column(Modifier.weight(1f).padding(horizontal = 10.dp)) {
                    Text("${item.actor} · ${item.room}", style = MaterialTheme.typography.labelMedium, fontFamily = JetBrainsMono, color = glass.inkSoft)
                    Text(item.summary, style = MaterialTheme.typography.bodyMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
                Column(horizontalAlignment = Alignment.End) {
                    Text(item.time, style = MaterialTheme.typography.labelSmall, color = glass.inkFaint, fontFamily = JetBrainsMono)
                    if (item.awaiting) TextButton(onClick = onAck) { Text("ACK") }
                }
            }
        }
    }
}

@Composable
private fun AgentsScreen(state: SynchronizeUiState, repository: SynchronizeRepository, onOpenAgent: (UiAgent) -> Unit) {
    val glass = LocalGlassTokens.current
    val scope = rememberCoroutineScope()
    Column(Modifier.fillMaxSize()) {
        Text("Agents", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(18.dp, 16.dp, 18.dp, 6.dp))
        SpawnComposer(state.spawnDraft, state, repository)
        LazyColumn {
            if (state.agents.isEmpty()) item { EmptyState("No agents registered") }
            items(state.agents, key = { it.peerId }) { peer ->
                AgentRow(peer, onOpen = { onOpenAgent(peer) }, onArchive = { scope.launch { repository.archivePeer(peer.peerId) } }, onResume = { scope.launch { repository.resumePeer(peer.peerId) } })
                HorizontalDivider(color = glass.rule)
            }
        }
    }
}

@Composable
private fun AgentRow(peer: UiAgent, onOpen: () -> Unit, onArchive: () -> Unit, onResume: () -> Unit) {
    val glass = LocalGlassTokens.current
    Row(
        Modifier.fillMaxWidth().clickable { onOpen() }.padding(horizontal = 18.dp, vertical = 12.dp),
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
            Text(
                peer.handle,
                style = MaterialTheme.typography.titleSmall,
                fontFamily = JetBrainsMono,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(peer.status, style = MaterialTheme.typography.bodyMedium, color = glass.inkSoft, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Surface(
            color = MaterialTheme.colorScheme.secondaryContainer,
            shape = RoundedCornerShape(6.dp),
            modifier = Modifier.widthIn(max = 132.dp),
        ) {
            Text(
                peer.model,
                fontFamily = JetBrainsMono,
                style = MaterialTheme.typography.labelSmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
            )
        }
        IconButton(onClick = onOpen) { Icon(Icons.Outlined.Info, "Profile") }
        IconButton(onClick = if (peer.archived) onResume else onArchive) {
            Icon(if (peer.archived) Icons.Outlined.PlayArrow else Icons.Outlined.Archive, if (peer.archived) "Resume" else "Archive")
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AgentProfileScreen(agent: UiAgent, repository: SynchronizeRepository, onBack: () -> Unit) {
    val glass = LocalGlassTokens.current
    val scope = rememberCoroutineScope()
    Column(Modifier.fillMaxSize()) {
        TopAppBar(
            title = {
                Column {
                    Text(agent.handle, fontFamily = JetBrainsMono, style = MaterialTheme.typography.titleMedium)
                    Text(agent.role, color = glass.inkSoft, style = MaterialTheme.typography.labelSmall)
                }
            },
            navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
            actions = {
                IconButton(onClick = { scope.launch { if (agent.archived) repository.resumePeer(agent.peerId) else repository.archivePeer(agent.peerId) } }) {
                    Icon(if (agent.archived) Icons.Outlined.PlayArrow else Icons.Outlined.Archive, if (agent.archived) "Resume" else "Archive")
                }
            },
            colors = TopAppBarDefaults.topAppBarColors(containerColor = Color.Transparent),
            windowInsets = WindowInsets(0, 0, 0, 0),
        )
        LazyColumn(
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            item {
                Surface(
                    color = MaterialTheme.colorScheme.surfaceContainer.copy(alpha = 0.82f),
                    shape = RoundedCornerShape(14.dp),
                    border = BorderStroke(1.dp, glass.rule),
                ) {
                    Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                        IdentityAvatar(agent.identity, agent.handle, 48)
                        Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                            Text(agent.handle, style = MaterialTheme.typography.titleMedium, fontFamily = JetBrainsMono)
                            Text(agent.status, style = MaterialTheme.typography.bodyMedium, color = glass.inkSoft)
                        }
                        AssistChip(onClick = {}, label = { Text(agent.presence, fontFamily = JetBrainsMono) })
                    }
                }
            }
            item { DetailRow("model", agent.model) }
            item { DetailRow("profile", agent.profileName ?: "none") }
            item { DetailRow("thinking", agent.thinking ?: "default") }
            item { DetailRow("cwd", agent.cwd ?: "unknown") }
            item { DetailRow("branch", agent.gitBranch ?: "unknown") }
            item { DetailRow("host", listOfNotNull(agent.hostTool, agent.hostSessionId).joinToString(" · ").ifBlank { "unknown" }) }
            item { DetailRow("launch", listOfNotNull(agent.launchState, agent.launchFailure).joinToString(" · ").ifBlank { "none" }) }
            if (agent.archived) item { DetailRow("archive", agent.archivedReason ?: "archived") }
            item {
                Button(
                    onClick = { scope.launch { if (agent.archived) repository.resumePeer(agent.peerId) else repository.archivePeer(agent.peerId) } },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Icon(if (agent.archived) Icons.Outlined.PlayArrow else Icons.Outlined.Archive, null)
                    Spacer(Modifier.width(8.dp))
                    Text(if (agent.archived) "Resume session" else "Archive session")
                }
            }
        }
    }
}

@Composable
private fun DetailRow(label: String, value: String) {
    val glass = LocalGlassTokens.current
    Surface(color = Color.Transparent, border = BorderStroke(1.dp, glass.rule), shape = RoundedCornerShape(10.dp)) {
        Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(label, modifier = Modifier.width(82.dp), fontFamily = JetBrainsMono, color = glass.inkFaint, style = MaterialTheme.typography.labelMedium)
            Text(value, modifier = Modifier.weight(1f), color = glass.inkSoft, style = MaterialTheme.typography.bodyMedium, maxLines = 3, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
private fun SpawnComposer(draft: SpawnDraft, state: SynchronizeUiState, repository: SynchronizeRepository) {
    val scope = rememberCoroutineScope()
    Surface(
        color = MaterialTheme.colorScheme.surfaceContainer.copy(alpha = 0.78f),
        shape = RoundedCornerShape(12.dp),
        border = BorderStroke(1.dp, LocalGlassTokens.current.rule),
        modifier = Modifier.padding(horizontal = 14.dp, vertical = 6.dp),
    ) {
        Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("Spawn", style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
                Button(onClick = { scope.launch { repository.spawnAgent() } }) { Text("Launch") }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = draft.name,
                    onValueChange = { value -> repository.updateSpawnDraft { it.copy(name = value) } },
                    label = { Text("Name") },
                    modifier = Modifier.weight(1f),
                    singleLine = true,
                )
                OutlinedTextField(
                    value = draft.group,
                    onValueChange = { value -> repository.updateSpawnDraft { it.copy(group = value) } },
                    label = { Text("Group") },
                    modifier = Modifier.weight(1f),
                    singleLine = true,
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = draft.tool,
                    onValueChange = { value -> repository.updateSpawnDraft { it.copy(tool = value) } },
                    label = { Text("Tool") },
                    modifier = Modifier.weight(1f),
                    singleLine = true,
                )
                OutlinedTextField(
                    value = draft.profile,
                    onValueChange = { value -> repository.updateSpawnDraft { it.copy(profile = value) } },
                    label = { Text("Profile") },
                    modifier = Modifier.weight(1f),
                    singleLine = true,
                )
            }
            OutlinedTextField(
                value = draft.repo,
                onValueChange = { value -> repository.updateSpawnDraft { it.copy(repo = value) } },
                label = { Text("Repo") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = draft.model,
                    onValueChange = { value -> repository.updateSpawnDraft { it.copy(model = value) } },
                    label = { Text("Model") },
                    modifier = Modifier.weight(1f),
                    singleLine = true,
                )
                OutlinedTextField(
                    value = draft.thinking,
                    onValueChange = { value -> repository.updateSpawnDraft { it.copy(thinking = value) } },
                    label = { Text("Thinking") },
                    modifier = Modifier.weight(1f),
                    singleLine = true,
                )
            }
            if (state.launchTools.isNotEmpty()) {
                Text("tools: ${state.launchTools.joinToString()}", fontFamily = JetBrainsMono, style = MaterialTheme.typography.labelSmall)
            }
            if (state.launchProfiles.isNotEmpty()) {
                Text("profiles: ${state.launchProfiles.take(4).joinToString { it.name }}", fontFamily = JetBrainsMono, style = MaterialTheme.typography.labelSmall)
            }
        }
    }
}

@Composable
private fun EmptyState(text: String) {
    Text(
        text,
        color = LocalGlassTokens.current.inkSoft,
        style = MaterialTheme.typography.bodyMedium,
        modifier = Modifier.padding(18.dp),
    )
}
