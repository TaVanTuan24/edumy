param(
    [string]$BaseUrl = "http://192.168.1.1:3000",
    [string]$Token = "",
    [string]$SourceUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    [ValidateSet("m3u8", "mp4")]
    [string]$PreferredFormat = "m3u8",
    [int]$TimeoutSec = 25,
    [switch]$SkipAuth
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

$endpoint = "$($BaseUrl.TrimEnd('/'))/api/vr/stream/resolve"
$bodyObject = [ordered]@{
    sourceUrl = $SourceUrl
    preferredFormat = $PreferredFormat
    courseId = "verify-course"
    lessonId = "verify-lesson"
}
$bodyJson = $bodyObject | ConvertTo-Json -Depth 4

$headers = @{
    "Content-Type" = "application/json"
}

if (-not $SkipAuth -and -not [string]::IsNullOrWhiteSpace($Token)) {
    $headers["Authorization"] = "Bearer $Token"
}

Write-Host "=== VR Stream Resolve Verifier ==="
Write-Host "Endpoint: $endpoint"
Write-Host "Source:   $SourceUrl"
Write-Host "Format:   $PreferredFormat"
Write-Host "Auth:     $(if ($headers.ContainsKey('Authorization')) { 'Bearer token provided' } else { 'none' })"
Write-Host ""

try {
    $response = Invoke-RestMethod -Uri $endpoint -Method Post -Headers $headers -Body $bodyJson -TimeoutSec $TimeoutSec

    Write-Host "HTTP: 200 OK"
    if ($null -eq $response) {
        Write-Host "FAIL: Empty response body"
        exit 2
    }

    if ($response.success -ne $true) {
        Write-Host "FAIL: success=false"
        if ($response.error) {
            Write-Host "error.code:    $($response.error.code)"
            Write-Host "error.message: $($response.error.message)"
            Write-Host "error.details: $($response.error.details)"
        }
        exit 1
    }

    $resolvedUrl = $response.data.resolvedUrl
    $provider = $response.data.provider
    $format = $response.data.format

    Write-Host "PASS: Resolver returned success=true"
    Write-Host "provider:    $provider"
    Write-Host "format:      $format"
    Write-Host "resolvedUrl: $resolvedUrl"

    if ([string]::IsNullOrWhiteSpace($resolvedUrl)) {
        Write-Host "FAIL: data.resolvedUrl is empty"
        exit 1
    }

    exit 0
}
catch {
    $exception = $_.Exception
    $statusCode = $null

    if ($exception.Response -and $exception.Response.StatusCode) {
        $statusCode = [int]$exception.Response.StatusCode
    }

    $rawBody = Read-ErrorResponseBody -Exception $exception
    $parsed = Try-ParseJson -Text $rawBody

    Write-Host "HTTP: $(if ($statusCode) { $statusCode } else { 'request-failed' })"

    if ($parsed) {
        $success = $parsed.success
        $code = if ($parsed.error) { $parsed.error.code } else { $null }
        $message = if ($parsed.error) { $parsed.error.message } else { $null }
        $details = if ($parsed.error) { $parsed.error.details } else { $null }

        Write-Host "success:      $success"
        Write-Host "error.code:   $code"
        Write-Host "error.message:$message"
        Write-Host "error.details:$details"

        if ($code -eq "UNAUTHORIZED") {
            Write-Host "Hint: cấp JWT VR token hợp lệ qua -Token hoặc bỏ -SkipAuth nếu endpoint cần auth."
        }
        elseif ($code -eq "RESOLVE_FAILED") {
            Write-Host "Hint: backend vẫn chưa resolve được source này; kiểm tra error.details để biết fail ở ytdl-core/yt-dlp-managed."
        }
    }
    else {
        Write-Host "Raw response body:"
        Write-Host $rawBody
        Write-Host "Request exception: $($exception.Message)"
    }

    exit 1
}
