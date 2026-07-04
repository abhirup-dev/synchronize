package dev.synchronize.android.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.googlefonts.Font
import androidx.compose.ui.text.googlefonts.GoogleFont
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import dev.synchronize.android.R

/*
 * Synchronize Glass token contract → Material 3.
 * Mirrors web/src/styles/tokens.css glass + kanagawa-wave blocks: role tokens
 * (paper/ink/rule/bubble/accent) keep their names so web ↔ android stay in sync.
 * Palette differences = theme axis; material language = skin axis (glass only here).
 */
data class GlassTokens(
    val bg: Color,
    val card: Color,
    val popover: Color,
    val bubble: Color,
    val ink: Color,
    val inkSoft: Color,
    val inkFaint: Color,
    val rule: Color,
    val mutedFill: Color,
    val accent: Color,
    val success: Color,
    val danger: Color,
    // Muted identity slots (dark values are source-backed; reused for both themes)
    val identity: List<IdentitySlot>,
)

data class IdentitySlot(val bg: Color, val border: Color, val text: Color)

private val identitySlots = listOf(
    IdentitySlot(Color(0xFF998238), Color(0xFF7F6C2F), Color(0xFFDECC92)), // yellow
    IdentitySlot(Color(0xFF993861), Color(0xFF7F2F51), Color(0xFFDE92B2)), // pink
    IdentitySlot(Color(0xFF395298), Color(0xFF2F447E), Color(0xFF92A6DD)), // blue
    IdentitySlot(Color(0xFF498852), Color(0xFF3D7144), Color(0xFF9FD0A6)), // green
    IdentitySlot(Color(0xFF995F38), Color(0xFF7F4E2F), Color(0xFFDEB092)), // orange
    IdentitySlot(Color(0xFF503899), Color(0xFF432F7F), Color(0xFFA592DE)), // purple
    IdentitySlot(Color(0xFF933E46), Color(0xFF7A343A), Color(0xFFD9969D)), // red
    IdentitySlot(Color(0xFF4B8681), Color(0xFF3E706B), Color(0xFFA0CFCB)), // teal
)

val DarkGlassTokens = GlassTokens(
    bg = Color(0xFF07090B),        // body wash #000000→#06080a, flattened
    card = Color(0xFF0B0B0C),      // --card #0b0b0cf7
    popover = Color(0xFF16181C),
    bubble = Color(0xFF16181C),
    ink = Color(0xFFE7E9EA),
    inkSoft = Color(0xFF8B98A5),
    inkFaint = Color(0xFF5B6671),
    rule = Color(0x1FFFFFFF),      // #ffffff1f
    mutedFill = Color(0x26FFFFFF),
    accent = Color(0xFF4F95DD),
    success = Color(0xFF00BA7C),
    danger = Color(0xFFF4212E),
    identity = identitySlots,
)

val LightGlassTokens = GlassTokens(
    bg = Color(0xFFF3F5F7),        // body wash #ffffff→#eef1f4, flattened
    card = Color(0xFFFFFFFF),
    popover = Color(0xFFF4F6F8),
    bubble = Color(0xFFF2F5F7),
    ink = Color(0xFF0F1419),
    inkSoft = Color(0xFF475662),
    inkFaint = Color(0xFF7C8893),
    rule = Color(0x1F0F1419),      // #0f14191f
    mutedFill = Color(0x260F1419),
    accent = Color(0xFF1D9BF0),
    success = Color(0xFF00BA7C),
    danger = Color(0xFFF4212E),
    identity = identitySlots,
)

val LocalGlassTokens = staticCompositionLocalOf { DarkGlassTokens }

private fun GlassTokens.toDarkScheme(): ColorScheme = darkColorScheme(
    primary = accent, onPrimary = Color.White,
    primaryContainer = accent.copy(alpha = 0.16f), onPrimaryContainer = ink,
    background = bg, onBackground = ink,
    surface = bg, onSurface = ink,
    surfaceContainer = card, surfaceContainerHigh = popover, surfaceContainerHighest = popover,
    surfaceContainerLow = card, surfaceContainerLowest = card,
    surfaceVariant = bubble, onSurfaceVariant = inkSoft,
    outline = rule, outlineVariant = rule,
    error = danger, onError = Color.White,
    secondary = inkSoft, onSecondary = bg,
    secondaryContainer = mutedFill, onSecondaryContainer = ink,
    tertiary = success, onTertiary = Color.White,
)

private fun GlassTokens.toLightScheme(): ColorScheme = lightColorScheme(
    primary = accent, onPrimary = Color.White,
    primaryContainer = accent.copy(alpha = 0.12f), onPrimaryContainer = ink,
    background = bg, onBackground = ink,
    surface = bg, onSurface = ink,
    surfaceContainer = card, surfaceContainerHigh = popover, surfaceContainerHighest = popover,
    surfaceContainerLow = card, surfaceContainerLowest = card,
    surfaceVariant = bubble, onSurfaceVariant = inkSoft,
    outline = rule, outlineVariant = rule,
    error = danger, onError = Color.White,
    secondary = inkSoft, onSecondary = bg,
    secondaryContainer = mutedFill, onSecondaryContainer = ink,
    tertiary = success, onTertiary = Color.White,
)

// Fonts via GMS downloadable fonts; fall back to system sans/mono when offline.
private val fontProvider = GoogleFont.Provider(
    providerAuthority = "com.google.android.gms.fonts",
    providerPackage = "com.google.android.gms",
    certificates = R.array.com_google_android_gms_fonts_certs,
)

val SpaceGrotesk = FontFamily(
    Font(GoogleFont("Space Grotesk"), fontProvider, FontWeight.Normal),
    Font(GoogleFont("Space Grotesk"), fontProvider, FontWeight.Medium),
    Font(GoogleFont("Space Grotesk"), fontProvider, FontWeight.SemiBold),
    Font(GoogleFont("Space Grotesk"), fontProvider, FontWeight.Bold),
)

val JetBrainsMono = FontFamily(
    Font(GoogleFont("JetBrains Mono"), fontProvider, FontWeight.Normal),
    Font(GoogleFont("JetBrains Mono"), fontProvider, FontWeight.Medium),
)

private val glassTypography = Typography().let { base ->
    fun TextStyle.grotesk() = copy(fontFamily = SpaceGrotesk)
    Typography(
        displayLarge = base.displayLarge.grotesk(),
        displayMedium = base.displayMedium.grotesk(),
        displaySmall = base.displaySmall.grotesk(),
        headlineLarge = base.headlineLarge.grotesk(),
        headlineMedium = base.headlineMedium.grotesk(),
        headlineSmall = base.headlineSmall.grotesk(),
        titleLarge = base.titleLarge.grotesk().copy(fontWeight = FontWeight.SemiBold, letterSpacing = (-0.01).em),
        titleMedium = base.titleMedium.grotesk().copy(fontWeight = FontWeight.SemiBold),
        titleSmall = base.titleSmall.grotesk().copy(fontWeight = FontWeight.SemiBold),
        bodyLarge = base.bodyLarge.grotesk().copy(fontSize = 16.sp, lineHeight = 23.sp),
        bodyMedium = base.bodyMedium.grotesk().copy(fontSize = 14.sp, lineHeight = 21.sp),
        bodySmall = base.bodySmall.grotesk(),
        labelLarge = base.labelLarge.grotesk().copy(fontWeight = FontWeight.SemiBold, letterSpacing = 0.02.em),
        labelMedium = base.labelMedium.grotesk().copy(fontWeight = FontWeight.SemiBold, letterSpacing = 0.02.em),
        labelSmall = base.labelSmall.grotesk().copy(letterSpacing = 0.06.em),
    )
}

@Composable
fun GlassTheme(
    dark: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val tokens = if (dark) DarkGlassTokens else LightGlassTokens
    androidx.compose.runtime.CompositionLocalProvider(LocalGlassTokens provides tokens) {
        MaterialTheme(
            colorScheme = if (dark) tokens.toDarkScheme() else tokens.toLightScheme(),
            typography = glassTypography,
            content = content,
        )
    }
}
