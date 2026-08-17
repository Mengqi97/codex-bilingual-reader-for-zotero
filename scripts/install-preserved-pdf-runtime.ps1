param(
  [Parameter(Mandatory = $true)]
  [string]$RuntimeRoot,
  [string]$EngineArchivePath = ""
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$engineUrl = "https://github.com/PDFMathTranslate-next/PDFMathTranslate-next/releases/download/v2.9.0/pdf2zh-v2.9.0-BabelDOC-v0.6.4-with-assets-win64.zip"
$engineSha256 = "6916a2f299b029cfb75803c780528088d93e7694d5597c4250ba2dcf5598f1d8"
$nodeUrl = "https://nodejs.org/dist/v24.19.0/win-x64/node.exe"
$nodeSha256 = "3602f2bb1a10f2cbab4c36886218a33c1ab3db87290e73b033c46c77147d0237"

$runtime = [IO.Path]::GetFullPath($RuntimeRoot)
$downloads = [IO.Path]::Combine($runtime, "downloads")
$tools = [IO.Path]::Combine($runtime, ".tools")
$engineParent = [IO.Path]::Combine($tools, "pdf2zh-next-staging-2.9.0-babeldoc-0.6.4")
$engineRoot = [IO.Path]::Combine($engineParent, "pdf2zh")
$engineExe = [IO.Path]::Combine($engineRoot, "pdf2zh.exe")
$staging = [IO.Path]::Combine($runtime, ".install-staging-pdf2zh")

function Assert-ChildPath([string]$Path) {
  $resolved = [IO.Path]::GetFullPath($Path)
  $prefix = $runtime.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
  if (-not $resolved.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to modify a path outside the runtime directory: $resolved"
  }
}

function Test-Hash([string]$Path, [string]$Expected) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() -eq $Expected
}

function Download-Verified([string]$Url, [string]$Destination, [string]$Expected) {
  if (Test-Hash $Destination $Expected) { return }
  $curl = [IO.Path]::Combine($env:SystemRoot, "System32", "curl.exe")
  if (-not (Test-Path -LiteralPath $curl -PathType Leaf)) { throw "Windows curl.exe was not found." }
  & $curl --fail --location --retry 3 --continue-at - --output $Destination $Url
  if ($LASTEXITCODE -ne 0) { throw "Download failed with curl exit code ${LASTEXITCODE}: $Url" }
  if (-not (Test-Hash $Destination $Expected)) {
    throw "SHA-256 verification failed for $Destination"
  }
}

New-Item -ItemType Directory -Force -Path $runtime, $downloads, $tools | Out-Null
Assert-ChildPath $engineParent
Assert-ChildPath $staging

if (-not (Test-Path -LiteralPath $engineExe -PathType Leaf)) {
  $archive = if ($EngineArchivePath) {
    [IO.Path]::GetFullPath($EngineArchivePath)
  } else {
    [IO.Path]::Combine($downloads, "pdf2zh-v2.9.0-BabelDOC-v0.6.4-with-assets-win64.zip")
  }
  if (-not $EngineArchivePath) {
    Download-Verified $engineUrl $archive $engineSha256
  } elseif (-not (Test-Path -LiteralPath $archive -PathType Leaf)) {
    throw "The supplied engine archive does not exist: $archive"
  }

  if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $staging | Out-Null
  $tar = [IO.Path]::Combine($env:SystemRoot, "System32", "tar.exe")
  if (-not (Test-Path -LiteralPath $tar -PathType Leaf)) { throw "Windows tar.exe was not found." }
  & $tar -xf $archive -C $staging
  if ($LASTEXITCODE -ne 0) { throw "Archive extraction failed with tar exit code $LASTEXITCODE." }
  $extracted = [IO.Path]::Combine($staging, "pdf2zh")
  if (-not (Test-Path -LiteralPath ([IO.Path]::Combine($extracted, "pdf2zh.exe")))) {
    throw "The official archive did not contain pdf2zh/pdf2zh.exe."
  }
  if (Test-Path -LiteralPath $engineRoot) { Remove-Item -LiteralPath $engineRoot -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $engineParent | Out-Null
  Move-Item -LiteralPath $extracted -Destination $engineRoot
  Remove-Item -LiteralPath $staging -Recurse -Force
}

$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue | Select-Object -First 1
if ($nodeCommand) {
  $nodeExe = $nodeCommand.Source
} else {
  $nodeDirectory = [IO.Path]::Combine($tools, "node")
  $nodeExe = [IO.Path]::Combine($nodeDirectory, "node.exe")
  New-Item -ItemType Directory -Force -Path $nodeDirectory | Out-Null
  Download-Verified $nodeUrl $nodeExe $nodeSha256
}

$launcher = [IO.Path]::Combine($runtime, "scripts", "translate-preserved-pdf-cli.mjs")
if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) { throw "Runtime launcher is missing: $launcher" }
if (-not (Test-Path -LiteralPath $engineExe -PathType Leaf)) { throw "PDF engine is missing after installation: $engineExe" }

$result = [ordered]@{
  runtimeRoot = $runtime
  launcher = $launcher
  engine = $engineExe
  node = [IO.Path]::GetFullPath($nodeExe)
}
Write-Output ("INSTALL_JSON=" + ($result | ConvertTo-Json -Compress))
