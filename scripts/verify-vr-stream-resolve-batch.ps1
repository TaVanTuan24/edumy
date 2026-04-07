param(
    [string]$BaseUrl = "http://192.168.1.1:3000",
    [string]$Token = "",
    [string[]]$Links = @(),
    [string]$LinksFile = "",
    [ValidateSet("m3u8", "mp4")]
    [string]$PreferredFormat = "m3u8",
    [int]$TimeoutSec = 25,
    [switch]$SkipAuth,
    [string]$OutJson = ""
)

$ErrorActionPreference = "Stop"

function Read-ErrorResponseBody {
    param([System.Exception]$Exception)

    if (-not $Exception.Response) {
        return $null
    }

    try {
        $stream = $Exception.Response.GetResponseStream()
        if (-not $stream) { return $null }

        $reader = New-Object System.IO.StreamReader($stream)
        $body = $reader.ReadToEnd()
        $reader.Dispose()
        return $body
    }
    catch {
        return $null
    }
}

function Try-ParseJson {
    param([string]$Text)

    if ([string]::IsNullOrWhiteSpace($Text)) { return $null }

    try {
        return $Text | ConvertFrom-Json
    }
    catch {
        return $null
    }
}

function Get-InputLinks {
    param([string[]]$ArgLinks, [string]$ArgLinksFile)

    $allLinks = New-Object System.Collections.Generic.List[string]

    if ($ArgLinks) {
        foreach ($item in $ArgLinks) {
            if (-not [string]::IsNullOrWhiteSpace($item)) {
                $allLinks.Add($item.Trim())
            }
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($ArgLinksFile)) {
        if (-not (Test-Path $ArgLinksFile)) {
            throw "LinksFile not found: $ArgLinksFile"
        }

        $lines = Get-Content $ArgLinksFile
        foreach ($line in $lines) {
            $text = [string]$line
            if ([string]::IsNullOrWhiteSpace($text)) { continue }
            $trimmed = $text.Trim()
            if ($trimmed.StartsWith('#')) { continue }
            $allLinks.Add($trimmed)
        }
    }

    return $allLinks.ToArray()
}

$endpoint = "$($BaseUrl.TrimEnd('/'))/api/vr/stream/resolve"
$headers = @{
    "Content-Type" = "application/json"
}

if (-not $SkipAuth -and -not [string]::IsNullOrWhiteSpace($Token)) {
    $headers["Authorization"] = "Bearer $Token"
}

$inputLinks = Get-InputLinks -ArgLinks $Links -ArgLinksFile $LinksFile
if (-not $inputLinks -or $inputLinks.Count -eq 0) {
    Write-Host "No links provided. Use -Links or -LinksFile."
    exit 2
}

$results = New-Object System.Collections.Generic.List[object]

Write-Host "=== VR Stream Resolve Batch Verifier ==="
Write-Host "Endpoint: $endpoint"
Write-Host "Total links: $($inputLinks.Count)"
Write-Host "Auth: $(if ($headers.ContainsKey('Authorization')) { 'Bearer token provided' } else { 'none' })"
Write-Host ""

$index = 0
foreach ($link in $inputLinks) {
    $index += 1

    $bodyObject = [ordered]@{
        sourceUrl = $link
        preferredFormat = $PreferredFormat
        courseId = "verify-course"
        lessonId = "verify-lesson-$index"
    }
    $bodyJson = $bodyObject | ConvertTo-Json -Depth 4

    $row = [ordered]@{
        index = $index
        link = $link
        ok = $false
        httpStatus = ""
        code = ""
        message = ""
        details = ""
        provider = ""
        format = ""
        resolvedUrl = ""
    }

    try {
        $response = Invoke-RestMethod -Uri $endpoint -Method Post -Headers $headers -Body $bodyJson -TimeoutSec $TimeoutSec

        $row.httpStatus = "200"
        if ($null -ne $response -and $response.success -eq $true -and $response.data -and -not [string]::IsNullOrWhiteSpace($response.data.resolvedUrl)) {
            $row.ok = $true
            $row.provider = [string]$response.data.provider
            $row.format = [string]$response.data.format
            $row.resolvedUrl = [string]$response.data.resolvedUrl
            $row.message = "success"
            Write-Host "[$index/$($inputLinks.Count)] PASS $link"
        }
        else {
            $row.ok = $false
            $row.code = [string]($response.error.code)
            $row.message = [string]($response.error.message)
            $row.details = [string]($response.error.details)
            Write-Host "[$index/$($inputLinks.Count)] FAIL $link => $($row.code) $($row.message)"
        }
    }
    catch {
        $exception = $_.Exception
        $statusCode = "request-failed"
        if ($exception.Response -and $exception.Response.StatusCode) {
            $statusCode = [string]([int]$exception.Response.StatusCode)
        }

        $row.httpStatus = $statusCode

        $rawBody = Read-ErrorResponseBody -Exception $exception
        $parsed = Try-ParseJson -Text $rawBody

        if ($parsed -and $parsed.error) {
            $row.code = [string]$parsed.error.code
            $row.message = [string]$parsed.error.message
            $row.details = [string]$parsed.error.details
            Write-Host "[$index/$($inputLinks.Count)] FAIL $link => HTTP $statusCode | $($row.code) $($row.message)"
        }
        else {
            $row.message = [string]$exception.Message
            $row.details = [string]$rawBody
            Write-Host "[$index/$($inputLinks.Count)] FAIL $link => HTTP $statusCode | $($row.message)"
        }
    }

    $results.Add([PSCustomObject]$row)
}

$passCount = ($results | Where-Object { $_.ok }).Count
$failCount = $results.Count - $passCount

Write-Host ""
Write-Host "=== Summary ==="
Write-Host "Total: $($results.Count)"
Write-Host "Pass:  $passCount"
Write-Host "Fail:  $failCount"

if ($failCount -gt 0) {
    Write-Host ""
    Write-Host "Failed items:"
    $results |
        Where-Object { -not $_.ok } |
        Select-Object index, httpStatus, code, message, link |
        Format-Table -AutoSize |
        Out-String |
        Write-Host
}

if (-not [string]::IsNullOrWhiteSpace($OutJson)) {
    $json = $results | ConvertTo-Json -Depth 6
    Set-Content -Path $OutJson -Value $json -Encoding UTF8
    Write-Host "Saved JSON report: $OutJson"
}

if ($failCount -gt 0) { exit 1 }
exit 0
