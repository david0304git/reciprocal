package com.lutszhong.reciprocal.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/**
 * The UI itself lives in the WebView, so the Compose theme only needs to match the app's paper
 * background for the window/system bars and to avoid a white flash before the page paints.
 * (The web layer owns the real design tokens: see `web/src/styles/app.css`.)
 */
private val PaperLight = Color(0xFFF6F4EF)
private val PaperDark = Color(0xFF141210)

private val LightColors = lightColorScheme(
    primary = Color(0xFF3F7C6A),
    background = PaperLight,
    surface = PaperLight,
    onBackground = Color(0xFF23201C),
    onSurface = Color(0xFF23201C),
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFF8FD8C4),
    background = PaperDark,
    surface = PaperDark,
    onBackground = Color(0xFFF2EEE6),
    onSurface = Color(0xFFF2EEE6),
)

@Composable
fun ReciprocalTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        content = content,
    )
}
