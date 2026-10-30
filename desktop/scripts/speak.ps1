# Makes a spoken WAV for testing the local speech engine.
#
# It uses a voice already on the computer, so nothing is downloaded and the fixture is
# the same everywhere. The file is 16 kHz mono, which is what the model wants.
#
#   powershell -File scripts/speak.ps1 -Text "..." -Out speech.wav
param(
  [string]$Text = "The quick brown fox jumps over the lazy dog.",
  [string]$Out = "speech.wav",
  [int]$Rate = 0
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(
  16000,
  [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,
  [System.Speech.AudioFormat.AudioChannel]::Mono
)
$synth.SetOutputToWaveFile($Out, $format)
$synth.Rate = $Rate
$synth.Speak($Text)
$synth.Dispose()
Write-Output "wrote $Out"
