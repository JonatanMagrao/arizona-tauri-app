$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

# Builds synthetic packages with an ephemeral in-memory certificate and a real
# XMLDSig signature. Tests therefore exercise possession of the private key,
# the PackageContents manifest and every raw file digest without ever reading
# Arizona's private release certificate.
$script:ArizonaSyntheticSigningIdentities = @{}

function Get-SyntheticSigningIdentity {
  param([Parameter(Mandatory = $true)][string]$Seed)

  if ($script:ArizonaSyntheticSigningIdentities.ContainsKey($Seed)) {
    return $script:ArizonaSyntheticSigningIdentities[$Seed]
  }

  Add-Type -AssemblyName System.Security | Out-Null
  $rsa = [System.Security.Cryptography.RSA]::Create(2048)
  $seedBytes = [System.Text.Encoding]::UTF8.GetBytes($Seed)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $seedId = (($sha.ComputeHash($seedBytes) | Select-Object -First 8 | ForEach-Object {
      $_.ToString("x2")
    }) -join "")
  } finally {
    $sha.Dispose()
  }

  $request = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new(
    "CN=Arizona Installer Test $seedId",
    $rsa,
    [System.Security.Cryptography.HashAlgorithmName]::SHA256,
    [System.Security.Cryptography.RSASignaturePadding]::Pkcs1
  )
  $certificate = $request.CreateSelfSigned(
    [DateTimeOffset]::Now.AddDays(-1),
    [DateTimeOffset]::Now.AddYears(1)
  )
  $certSha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $fingerprint = (($certSha.ComputeHash($certificate.RawData) | ForEach-Object {
      $_.ToString("x2")
    }) -join "")
  } finally {
    $certSha.Dispose()
  }

  $identity = [pscustomobject]@{
    Rsa = $rsa
    Certificate = $certificate
    Fingerprint = $fingerprint
  }
  $script:ArizonaSyntheticSigningIdentities[$Seed] = $identity
  return $identity
}

function New-SyntheticCepSignatureXml {
  param(
    [Parameter(Mandatory = $true)]$Entries,
    [Parameter(Mandatory = $true)]$Identity
  )

  Add-Type -AssemblyName System.Security | Out-Null
  $xmlDsigNamespace = "http://www.w3.org/2000/09/xmldsig#"
  $canonicalizationAlgorithm = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315"
  $digestAlgorithm = "http://www.w3.org/2001/04/xmlenc#sha256"

  $manifestDocument = New-Object System.Xml.XmlDocument
  $manifestDocument.PreserveWhitespace = $true
  $manifest = $manifestDocument.CreateElement("Manifest", $xmlDsigNamespace)
  $manifest.SetAttribute("Id", "PackageContents")
  [void]$manifestDocument.AppendChild($manifest)

  foreach ($entryName in $Entries.Keys) {
    $reference = $manifestDocument.CreateElement("Reference", $xmlDsigNamespace)
    $reference.SetAttribute("URI", [string]$entryName)
    $digestMethod = $manifestDocument.CreateElement("DigestMethod", $xmlDsigNamespace)
    $digestMethod.SetAttribute("Algorithm", $digestAlgorithm)
    $digestValue = $manifestDocument.CreateElement("DigestValue", $xmlDsigNamespace)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
      $digestValue.InnerText = [Convert]::ToBase64String($sha.ComputeHash([byte[]]$Entries[$entryName]))
    } finally {
      $sha.Dispose()
    }
    [void]$reference.AppendChild($digestMethod)
    [void]$reference.AppendChild($digestValue)
    [void]$manifest.AppendChild($reference)
  }

  $document = New-Object System.Xml.XmlDocument
  $document.PreserveWhitespace = $true
  $document.LoadXml("<signatures />")

  # SignedXml cannot resolve an Id nested inside a not-yet-serialized DataObject
  # on .NET Framework. A byte-identical temporary Manifest lets it calculate the
  # reference digest; the final document keeps only the Manifest inside Object.
  $temporaryManifest = $document.ImportNode($manifest, $true)
  [void]$document.DocumentElement.AppendChild($temporaryManifest)

  $signedXml = [System.Security.Cryptography.Xml.SignedXml]::new($document)
  $signedXml.SigningKey = $Identity.Rsa
  $signedXml.Signature.Id = "PackageSignature"
  $signedXml.SignedInfo.CanonicalizationMethod = $canonicalizationAlgorithm
  $signedXml.SignedInfo.SignatureMethod = "http://www.w3.org/2000/09/xmldsig#rsa-sha1"

  $signedReference = [System.Security.Cryptography.Xml.Reference]::new()
  $signedReference.Uri = "#PackageContents"
  $signedReference.Type = "http://www.w3.org/2000/09/xmldsig#Manifest"
  $signedReference.DigestMethod = $digestAlgorithm
  $signedReference.AddTransform([System.Security.Cryptography.Xml.XmlDsigC14NTransform]::new())
  $signedXml.AddReference($signedReference)

  $keyInfo = [System.Security.Cryptography.Xml.KeyInfo]::new()
  $keyInfo.AddClause(
    [System.Security.Cryptography.Xml.KeyInfoX509Data]::new($Identity.Certificate)
  )
  $signedXml.KeyInfo = $keyInfo

  $dataObject = [System.Security.Cryptography.Xml.DataObject]::new()
  $dataObject.Data = $manifestDocument.ChildNodes
  $signedXml.AddObject($dataObject)
  $signedXml.ComputeSignature()

  [void]$document.DocumentElement.RemoveChild($temporaryManifest)
  $signature = $document.ImportNode($signedXml.GetXml(), $true)
  $signatureValue = $signature.SelectSingleNode("./*[local-name()='SignatureValue']")
  $signatureValue.SetAttribute("Id", "PackageSignatureValue")
  [void]$document.DocumentElement.AppendChild($signature)
  return $document.OuterXml
}

function New-SyntheticZxp {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [string]$BundleId = "com.arizona-carrefour.cep",
    [string]$BundleVersion = "9.9.9",
    [string]$CertificateSeed = "arizona-test-certificate",
    [switch]$OmitSignatures,
    [switch]$OmitMimetype,
    [switch]$OmitDebug,
    [switch]$IncludeSourceMap,
    [switch]$IncludeExtractionConflict,
    [switch]$TamperSignatureValue,
    [switch]$TamperContentAfterSigning,
    [switch]$AddUnsignedFileAfterSigning
  )

  $fullPath = Get-FullPath $Path
  $identity = Get-SyntheticSigningIdentity -Seed $CertificateSeed

  # Entries are written one by one: ZipFile.CreateFromDirectory on .NET
  # Framework stores backslash separators, which a real .zxp never uses.
  $textEntries = [ordered]@{
    "CSXS/manifest.xml" = @"
<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<ExtensionManifest Version="6.0" ExtensionBundleId="$BundleId" ExtensionBundleVersion="$BundleVersion" ExtensionBundleName="Arizona - Carrefour" />
"@
    "main/index.html" = "<html></html>"
  }

  # Part of the signature manifest, so the release pipeline must ship it as is.
  if (!$OmitDebug) {
    $textEntries[".debug"] = "<ExtensionList />"
  }

  if ($IncludeSourceMap) {
    # Mixed case plus a backslash ensures consumers normalize before matching.
    $textEntries["main\bundle.JS.MAP"] = "{}"
  }

  if ($IncludeExtractionConflict) {
    # Both names are individually safe and distinct, but the second requires a
    # directory where the first already extracted an ordinary file.
    $textEntries["extraction-conflict"] = "file"
    $textEntries["extraction-conflict/child.txt"] = "child"
  }

  if (!$OmitMimetype) {
    $textEntries["mimetype"] = "application/vnd.adobe.air-cep-extension-package+zip"
  }

  $utf8 = New-Object System.Text.UTF8Encoding($false)
  $entries = [ordered]@{}
  foreach ($entryName in $textEntries.Keys) {
    $entries[$entryName] = $utf8.GetBytes([string]$textEntries[$entryName])
  }
  if (!$OmitSignatures) {
    $signatureXml = New-SyntheticCepSignatureXml -Entries $entries -Identity $identity
    if ($TamperSignatureValue) {
      $signatureDocument = New-Object System.Xml.XmlDocument
      $signatureDocument.PreserveWhitespace = $true
      $signatureDocument.LoadXml($signatureXml)
      $signatureValue = $signatureDocument.SelectSingleNode("//*[local-name()='SignatureValue']")
      $value = ($signatureValue.InnerText -replace "\s", "")
      $replacement = if ($value.StartsWith("A")) { "B" } else { "A" }
      $signatureValue.InnerText = $replacement + $value.Substring(1)
      $signatureXml = $signatureDocument.OuterXml
    }
    $entries["META-INF/signatures.xml"] = $utf8.GetBytes($signatureXml)
  }
  if ($TamperContentAfterSigning) {
    $entries["main/index.html"] = $utf8.GetBytes("<html>tampered after signing</html>")
  }
  if ($AddUnsignedFileAfterSigning) {
    $entries["unsigned-extra.txt"] = $utf8.GetBytes("not covered by PackageContents")
  }

  if (Test-Path -LiteralPath $fullPath) {
    Remove-Item -LiteralPath $fullPath -Force
  }
  New-Item -ItemType Directory -Force -Path ([System.IO.Path]::GetDirectoryName($fullPath)) | Out-Null

  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [System.IO.Compression.ZipFile]::Open($fullPath, [System.IO.Compression.ZipArchiveMode]::Create)
  try {
    foreach ($entryName in $entries.Keys) {
      $entry = $archive.CreateEntry($entryName)
      $stream = $entry.Open()
      try {
        $bytes = [byte[]]$entries[$entryName]
        $stream.Write($bytes, 0, $bytes.Length)
      } finally {
        $stream.Dispose()
      }
    }
  } finally {
    $archive.Dispose()
  }

  return [pscustomobject]@{
    Path = $fullPath
    BundleId = $BundleId
    BundleVersion = $BundleVersion
    Sha256 = Get-FileSha256 $fullPath
    CertificateFingerprint = $identity.Fingerprint
  }
}

function New-SyntheticCepPayload {
  param(
    [Parameter(Mandatory = $true)][string]$PayloadRoot,
    [string]$AppPackageVersion = "test",
    [string]$TauriVersion = "test",
    [string]$BundleVersion = "9.9.9",
    [string]$CertificateSeed = "arizona-test-certificate",
    [string]$Sha256Override = "",
    [switch]$OmitSignatures,
    [switch]$OmitDebug,
    [switch]$IncludeSourceMap,
    [switch]$IncludeExtractionConflict,
    [switch]$TamperSignatureValue,
    [switch]$TamperContentAfterSigning,
    [switch]$AddUnsignedFileAfterSigning
  )

  $payloadRootFull = Get-FullPath $PayloadRoot
  New-Item -ItemType Directory -Force -Path (Join-Path $payloadRootFull "cep") | Out-Null

  $zxp = New-SyntheticZxp `
    -Path (Join-Path $payloadRootFull "cep\com.arizona-carrefour.cep.zxp") `
    -BundleVersion $BundleVersion `
    -CertificateSeed $CertificateSeed `
    -OmitSignatures:$OmitSignatures `
    -OmitDebug:$OmitDebug `
    -IncludeSourceMap:$IncludeSourceMap `
    -IncludeExtractionConflict:$IncludeExtractionConflict `
    -TamperSignatureValue:$TamperSignatureValue `
    -TamperContentAfterSigning:$TamperContentAfterSigning `
    -AddUnsignedFileAfterSigning:$AddUnsignedFileAfterSigning

  $manifest = [pscustomobject]@{
    schemaVersion = 3
    generatedAt = (Get-Date).ToUniversalTime().ToString("o")
    appPackageVersion = $AppPackageVersion
    tauriVersion = $TauriVersion
    cepExtensionId = "com.arizona-carrefour.cep"
    cepZxpFileName = "com.arizona-carrefour.cep.zxp"
    cepZxpSha256 = if ([string]::IsNullOrWhiteSpace($Sha256Override)) { $zxp.Sha256 } else { $Sha256Override }
    cepBundleVersion = $BundleVersion
    includesAfterEffectsPlugin = $false
    includesAdminApp = $false
  }
  Write-JsonFileAtomic -Path (Join-Path $payloadRootFull "release-manifest.json") -Value $manifest

  return [pscustomobject]@{
    PayloadRoot = $payloadRootFull
    Zxp = $zxp
    Manifest = $manifest
  }
}
