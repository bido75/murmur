package com.murmur.wear

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.SystemClock
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.material.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : ComponentActivity() {
    private val askMic = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {}

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            askMic.launch(arrayOf(Manifest.permission.RECORD_AUDIO, Manifest.permission.POST_NOTIFICATIONS))
        }
        setContent { MaterialTheme { App() } }
    }

    @Composable
    private fun App() {
        var token by remember { mutableStateOf(Store.token(this)) }
        if (token == null) LinkScreen { token = it } else RecordScreen()
    }

    @Composable
    private fun LinkScreen(onLinked: (String) -> Unit) {
        var code by remember { mutableStateOf("") }
        var error by remember { mutableStateOf<String?>(null) }
        var busy by remember { mutableStateOf(false) }
        val scope = rememberCoroutineScope()
        ScalingLazyColumn(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally) {
            item { Text("Link Murmur", fontWeight = FontWeight.Bold) }
            item { Text("App: Settings → Devices → Show a code", fontSize = 12.sp, textAlign = TextAlign.Center, color = Color.Gray) }
            item {
                androidx.compose.foundation.text.BasicTextField(
                    value = code, onValueChange = { code = it.uppercase().take(9) }, singleLine = true,
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters),
                    textStyle = androidx.compose.ui.text.TextStyle(color = Color.White, fontSize = 18.sp, textAlign = TextAlign.Center),
                    modifier = Modifier.fillMaxWidth().padding(8.dp),
                )
            }
            item {
                Chip(label = { Text(if (busy) "Linking…" else "Link") }, enabled = code.count { it.isLetterOrDigit() } >= 8 && !busy, onClick = {
                    busy = true
                    scope.launch {
                        try {
                            val t = withContext(Dispatchers.IO) { Api.link(code) }
                            Store.setToken(this@MainActivity, t)
                            onLinked(t)
                        } catch (e: Exception) { error = e.message }
                        busy = false
                    }
                })
            }
            error?.let { item { Text(it, color = Color(0xFFF97066), fontSize = 12.sp) } }
        }
    }

    @Composable
    private fun RecordScreen() {
        var recording by remember { mutableStateOf(RecorderService.isRecording) }
        var consent by remember { mutableStateOf<String?>(null) }
        var now by remember { mutableLongStateOf(SystemClock.elapsedRealtime()) }
        LaunchedEffect(recording) { while (recording) { now = SystemClock.elapsedRealtime(); delay(500) } }
        val pending = remember(recording) { Store.pendingCount(this) }
        ScalingLazyColumn(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally) {
            if (recording) {
                item { Text(clock(now - RecorderService.startedAt), fontSize = 34.sp, fontWeight = FontWeight.SemiBold) }
                item {
                    Button(onClick = { RecorderService.stop(this@MainActivity); recording = false }, colors = ButtonDefaults.buttonColors(backgroundColor = Color(0xFFB42318)), modifier = Modifier.size(64.dp)) { Text("Stop") }
                }
            } else {
                item { Text("Who knows it's recorded?", fontSize = 12.sp, color = Color.Gray) }
                listOf("told_everyone" to "I told everyone", "solo" to "Just me", "not_confirmed" to "Ask later").forEach { (v, l) ->
                    item { ToggleChip(checked = consent == v, onCheckedChange = { consent = v }, label = { Text(l) }, toggleControl = { RadioButton(selected = consent == v) }, modifier = Modifier.fillMaxWidth()) }
                }
                item {
                    Button(enabled = consent != null, onClick = { RecorderService.start(this@MainActivity, consent!!); recording = true }, colors = ButtonDefaults.buttonColors(backgroundColor = Color(0xFFB42318)), modifier = Modifier.size(64.dp)) { Text("Rec") }
                }
            }
            if (pending > 0) item { Text("$pending waiting to upload", fontSize = 12.sp, color = Color.Gray) }
        }
    }

    private fun clock(ms: Long): String {
        val s = ms / 1000
        return if (s >= 3600) "%d:%02d:%02d".format(s / 3600, s / 60 % 60, s % 60) else "%02d:%02d".format(s / 60, s % 60)
    }
}
