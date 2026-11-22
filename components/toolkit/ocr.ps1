param([switch]$Layout)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics.Imaging,ContentType=WindowsRuntime]
$null = [Windows.Storage.Streams.InMemoryRandomAccessStream,Windows.Storage.Streams,ContentType=WindowsRuntime]
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetGenericArguments().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
function Await-Result($operation, $type) {
    $task = $asTask.MakeGenericMethod($type).Invoke($null, @($operation))
    $task.Wait()
    $task.Result
}
$memory = [Windows.Storage.Streams.InMemoryRandomAccessStream]::new()
$stream = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForWrite($memory)
$inputStream = [Console]::OpenStandardInput()
$inputStream.CopyTo($stream)
$stream.Flush()
$memory.Seek(0)
$decoder = Await-Result ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($memory)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await-Result ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap,Windows.Graphics.Imaging,ContentType=WindowsRuntime])
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($null -eq $engine) { throw 'Windows OCR language pack required' }
$result = Await-Result ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult,Windows.Foundation,ContentType=WindowsRuntime])
if ($Layout) {
    # A CJK profile can split Latin labels or miss leading glyphs beside connectors.
    if ($engine.RecognizerLanguage.LanguageTag -notlike 'en*' -and $result.Text -match '[A-Za-z]{2}' -and $result.Text -notmatch '[\p{IsCJKUnifiedIdeographs}\p{IsHiragana}\p{IsKatakana}\p{IsHangulSyllables}]') {
        $english = [Windows.Globalization.Language,Windows.Globalization,ContentType=WindowsRuntime]::new('en-US')
        $latinEngine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($english)
        if ($null -ne $latinEngine) {
            $latin = Await-Result ($latinEngine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult,Windows.Foundation,ContentType=WindowsRuntime])
            if ($latin.Text.Trim().Length -gt 0 -and ([regex]::Matches($latin.Text, '[0-9]').Count -ge [regex]::Matches($result.Text, '[0-9]').Count)) { $result = $latin }
        }
    }
    $lines = @(foreach ($line in $result.Lines) {
        $words = @(foreach ($word in $line.Words) {
            $r = $word.BoundingRect
            [ordered]@{ text=$word.Text; x=$r.X; y=$r.Y; w=$r.Width; h=$r.Height }
        })
        [ordered]@{ words=$words; angle=[double]$result.TextAngle }
    })
    [Console]::Write((ConvertTo-Json -Compress -Depth 6 -InputObject $lines))
    return
}
[Console]::Write(($result.Lines | ForEach-Object { $_.Text }) -join [Environment]::NewLine)
