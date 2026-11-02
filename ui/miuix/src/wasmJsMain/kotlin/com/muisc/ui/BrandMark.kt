package com.muisc.ui

import androidx.compose.foundation.Image
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.muisc.ui.resources.Res
import com.muisc.ui.resources.muisc_logo
import org.jetbrains.compose.resources.painterResource

@Composable
fun BrandMark(modifier: Modifier = Modifier) {
    Image(painter = painterResource(Res.drawable.muisc_logo), contentDescription = null, modifier = modifier)
}
