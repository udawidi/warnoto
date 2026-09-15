$ErrorActionPreference = "Stop"
$guideDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$files = @(
  "Panduan Stock Opname Gudang - WARNOTO.docx",
  "Panduan Stock Count Gudang - WARNOTO.docx",
  "Panduan Pengisian Maturity Level Gudang - WARNOTO.docx"
)

$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
try {
  foreach ($file in $files) {
    $docx = Join-Path $guideDir $file
    $pdf = [System.IO.Path]::ChangeExtension($docx, ".pdf")
    $document = $word.Documents.Open($docx, $false, $true)
    try {
      $document.ExportAsFixedFormat($pdf, 17)
    }
    finally {
      $document.Close($false)
    }
    Write-Output $pdf
  }
}
finally {
  $word.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
}
