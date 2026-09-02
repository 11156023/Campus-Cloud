$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$version = "1.1"
$filename = "wireguard-amd64-$version.msi"
$expectedSha256 = "6DAA5D37A9E2950DFB8C48B95AB8E562CB2BAD1C785D020F38F97BEA4C6A5566"
$downloadUrl = "https://download.wireguard.com/windows-client/$filename"
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$vendorRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot "vendor\wireguard"))
$destination = [System.IO.Path]::GetFullPath((Join-Path $vendorRoot $filename))
$temporary = "$destination.download"

if (-not $destination.StartsWith($vendorRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to write outside the WireGuard vendor directory."
}

New-Item -ItemType Directory -Force -Path $vendorRoot | Out-Null

function Test-WireGuardInstaller([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    return $false
  }
  $hash = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
  if ($hash -ne $expectedSha256) {
    return $false
  }
  $signature = Get-AuthenticodeSignature -LiteralPath $Path
  return (
    $signature.Status -eq [System.Management.Automation.SignatureStatus]::Valid -and
    $signature.SignerCertificate.Subject -match "CN=WireGuard LLC"
  )
}

if (Test-WireGuardInstaller $destination) {
  Write-Output "Verified bundled WireGuard installer: $filename"
  exit 0
}

try {
  Invoke-WebRequest -Uri $downloadUrl -OutFile $temporary
  if (-not (Test-WireGuardInstaller $temporary)) {
    throw "Downloaded WireGuard installer failed SHA-256 or Authenticode validation."
  }
  Move-Item -LiteralPath $temporary -Destination $destination -Force
  Write-Output "Downloaded and verified WireGuard installer: $filename"
}
finally {
  if (Test-Path -LiteralPath $temporary) {
    Remove-Item -LiteralPath $temporary -Force
  }
}
