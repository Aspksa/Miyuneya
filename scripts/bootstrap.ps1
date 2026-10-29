param([switch]$ProbeOnly, [switch]$ForcePortable)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtime = Join-Path $root '.runtime'
$utf8 = New-Object Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
$stage = 'bootstrap'
$exitCode = 20
function Write-BootLog([string]$eventName, [int]$code) {
    try {
        $dir = Join-Path $runtime 'logs'
        [IO.Directory]::CreateDirectory($dir) | Out-Null
        $line = @{ time=[DateTime]::UtcNow.ToString('o'); stage=$stage; event=$eventName; code=$code } | ConvertTo-Json -Compress
        [IO.File]::AppendAllText((Join-Path $dir 'bootstrap.log'), $line + "`n", $utf8)
    } catch { [Console]::Error.WriteLine('Could not write bootstrap diagnostic log.') }
}
function Test-Node([string]$path) {
    if (-not $path -or -not (Test-Path -LiteralPath $path -PathType Leaf)) { return $null }
    $process = New-Object Diagnostics.Process
    try {
        $info = New-Object Diagnostics.ProcessStartInfo
        $info.FileName = $path
        $info.Arguments = '-e "const v=process.versions.node.split(''.'').map(Number);if(v[0]<22||(v[0]===22&&v[1]<18))process.exit(9);require(''node:http'');require(''node:crypto'');require(''node:module'').stripTypeScriptTypes(''const n: number = 1;'');console.log(JSON.stringify({executable:process.execPath,version:process.versions.node,arch:process.arch}));"'
        $info.UseShellExecute = $false
        $info.CreateNoWindow = $true
        $info.RedirectStandardOutput = $true
        $info.RedirectStandardError = $true
        $info.StandardOutputEncoding = $utf8
        $process.StartInfo = $info
        [void]$process.Start()
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(10000)) { $process.Kill(); $process.WaitForExit(); return $null }
        $output = $stdout.GetAwaiter().GetResult()
        [void]$stderr.GetAwaiter().GetResult()
        if ($process.ExitCode -ne 0) { return $null }
        $result = $output | ConvertFrom-Json
        if (-not $result.executable -or -not $result.version) { return $null }
        return $result
    } catch { return $null }
    finally { $process.Dispose() }
}
try {
    if ($root.StartsWith('\\')) { throw 'UNC paths are not supported. Copy the project to a local drive.' }
    $stage = 'node-probe'
    $sources = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'runtime-sources.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $architecture = $env:PROCESSOR_ARCHITECTURE
    if ($env:PROCESSOR_ARCHITEW6432) { $architecture = $env:PROCESSOR_ARCHITEW6432 }
    $arch = if ($architecture -eq 'ARM64') { 'arm64' } elseif ($architecture -eq 'AMD64') { 'x64' } else { throw 'A 64-bit Windows installation is required.' }
    $nodeDirectory = Join-Path $runtime ('node-v' + $sources.version + '-win-' + $arch)
    $node = $null
    if ($env:MIYUNEYA_NODE) {
        $node = Test-Node $env:MIYUNEYA_NODE
        if (-not $node) { throw 'MIYUNEYA_NODE does not execute a supported Node.js. Correct or remove this explicit path.' }
    } else {
        $candidates = @((Join-Path $runtime 'node\node.exe'), (Join-Path $nodeDirectory 'node.exe'))
        if (-not $ForcePortable) { $candidates += @(Get-Command node.exe -CommandType Application -All -ErrorAction SilentlyContinue | ForEach-Object { $_.Source }) }
        foreach ($candidate in $candidates) { $node = Test-Node $candidate; if ($node) { break }; Write-BootLog 'candidate-rejected' 21 }
    }
    if (-not $node) {
        $stage = 'node-download'
        if ($env:MIYUNEYA_OFFLINE -eq '1') { throw 'Supported Node.js is missing and offline mode is enabled. Supply .runtime\node\node.exe or MIYUNEYA_NODE.' }
        [IO.Directory]::CreateDirectory($runtime) | Out-Null
        $stageDir = Join-Path $runtime ('node-download-' + [Guid]::NewGuid().ToString('N'))
        [IO.Directory]::CreateDirectory($stageDir) | Out-Null
        $candidateFile = Join-Path $stageDir 'node.exe'
        try {
            $url = 'https://nodejs.org/dist/v' + $sources.version + '/win-' + $arch + '/node.exe'
            Write-Host ('Preparing official portable Node.js ' + $sources.version + ' (' + $arch + ')...')
            [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
            $client = New-Object Net.WebClient
            try {
                $task = $client.DownloadFileTaskAsync([Uri]$url, $candidateFile)
                if (-not $task.Wait(120000)) { $client.CancelAsync(); throw 'Official Node.js download timed out. Retry online or supply portable Node.js.' }
                $task.GetAwaiter().GetResult()
            } finally { $client.Dispose() }
            $stage = 'node-sha256'
            # Use .NET directly: Get-FileHash may be hidden by the PSModulePath inherited from PowerShell 7 through Node.
            $sha = [Security.Cryptography.SHA256]::Create()
            $stream = [IO.File]::OpenRead($candidateFile)
            try { $actual = ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
            finally { $stream.Dispose(); $sha.Dispose() }
            if ($actual -ne $sources.windows.$arch) { throw 'SHA-256 mismatch. The downloaded binary will not be used.' }
            $stage = 'node-probe-download'
            $verified = Test-Node $candidateFile
            if (-not $verified -or $verified.version -ne $sources.version -or $verified.arch -ne $arch) { throw 'The verified download cannot execute correctly on this Windows installation.' }
            # Serialize installation, keeping any previous directory until the new binary passed both checks.
            $mutex = New-Object Threading.Mutex($false, 'Local\MiyuneyaPortableNodeInstall')
            $acquired = $false
            try {
                try { $acquired = $mutex.WaitOne(30000) } catch [Threading.AbandonedMutexException] { $acquired = $true }
                if (-not $acquired) { throw 'Another portable Node.js installation is still running.' }
                $existing = Test-Node (Join-Path $nodeDirectory 'node.exe')
                if (-not $existing) {
                    if (Test-Path -LiteralPath $nodeDirectory) { [IO.Directory]::Move($nodeDirectory, $nodeDirectory + '.rejected-' + [Guid]::NewGuid().ToString('N')) }
                    [IO.Directory]::Move($stageDir, $nodeDirectory)
                }
                $node = Test-Node (Join-Path $nodeDirectory 'node.exe')
                if (-not $node) { throw 'Portable Node.js installation validation failed.' }
            } finally { if ($acquired) { $mutex.ReleaseMutex() }; $mutex.Dispose() }
        } finally {
            if (Test-Path -LiteralPath $stageDir) {
                $removed = $false
                for ($attempt=0; $attempt -lt 5; $attempt++) {
                    try { Remove-Item -LiteralPath $stageDir -Recurse -Force; $removed=$true; break }
                    catch { if ($attempt -lt 4) { Start-Sleep -Milliseconds (100 * ($attempt + 1)) } }
                }
                if (-not $removed) { Write-BootLog 'download-cleanup-failed' 23; [Console]::Error.WriteLine('Temporary download cleanup failed. See .runtime/logs/bootstrap.log.') }
            }
        }
    }
    Write-BootLog 'node-ready' 0
    if ($ProbeOnly) { $node | ConvertTo-Json -Compress; exit 0 }
    $stage = 'node-launcher'
    $launcher = Join-Path $PSScriptRoot 'start.mjs'
    if ($env:MIYUNEYA_NO_OPEN -eq '1') { & $node.executable $launcher } else { & $node.executable $launcher '--open' }
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) { Write-BootLog 'launcher-failed' $exitCode }
    exit $exitCode
} catch {
    $typeName = $_.Exception.GetBaseException().GetType().Name
    Write-BootLog ('failed-' + $typeName) $exitCode
    [Console]::Error.WriteLine(('Miyuneya failed at stage: ' + $stage + ' (exit ' + $exitCode + ').'))
    # Controlled messages only: do not print arbitrary exceptions containing environment or secrets.
    $message = $_.Exception.Message
    if ($message -match '^(UNC paths|A 64-bit|MIYUNEYA_NODE|Supported Node|PowerShell Get-FileHash|Official Node|SHA-256|The verified|Another portable|Portable Node)') { [Console]::Error.WriteLine($message) }
    else { [Console]::Error.WriteLine(('Failure type: ' + $typeName + '. Check the project path, write permission and access to https://nodejs.org/. See .runtime/logs/bootstrap.log.')) }
    exit $exitCode
}
