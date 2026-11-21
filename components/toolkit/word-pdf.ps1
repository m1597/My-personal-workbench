param([string]$SourceFile,[string]$TargetPdf)
$ErrorActionPreference='Stop'
$word=$null
$document=$null
$noSave=0
$confirm=$false
$readOnly=$true
$recent=$false
try {
  $word=New-Object -ComObject Word.Application
  $word.Visible=$false
  $word.DisplayAlerts=0
  $word.AutomationSecurity=3
  $oldUpdateLinks=$word.Options.UpdateLinksAtOpen
  $word.Options.UpdateLinksAtOpen=$false
  $document=$word.Documents.Open([ref]$SourceFile,[ref]$confirm,[ref]$readOnly,[ref]$recent)
  $document.ExportAsFixedFormat($TargetPdf,17)
} finally {
  try {
    if ($document) { $document.Close([ref]$noSave); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($document) }
  } finally {
    if ($word) {
      try { if ($null -ne $oldUpdateLinks) { $word.Options.UpdateLinksAtOpen=$oldUpdateLinks } }
      finally { $word.Quit([ref]$noSave); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($word) }
    }
  }
}
