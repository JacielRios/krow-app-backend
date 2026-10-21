param(
    [string]$PostgresBin = '.tmp/postgresql17-tools/pgsql/bin',
    [switch]$AllApiTests
)
$ErrorActionPreference = 'Stop'
$repository = Split-Path $PSScriptRoot -Parent
$binPath = if ([IO.Path]::IsPathRooted($PostgresBin)) {
    [IO.Path]::GetFullPath($PostgresBin)
} else {
    [IO.Path]::GetFullPath((Join-Path $repository $PostgresBin))
}
foreach ($program in 'initdb.exe', 'pg_ctl.exe') {
    if (!(Test-Path -LiteralPath (Join-Path $binPath $program))) { throw "PostgreSQL binary missing: $program. Supply -PostgresBin." }
}
$testRoot = Join-Path $repository ('.tmp/postgres-test-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot | Out-Null
$dataPath = Join-Path $testRoot 'data'
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$listener.Start()
$testPort = $listener.LocalEndpoint.Port
$listener.Stop()
$previousPilotUrl = $env:TEST_PILOT_DATABASE_URL
$previousRuntimeUrl = $env:TEST_RUNTIME_DATABASE_URL
$started = $false
Push-Location $repository
try {
    # This disposable cluster contains synthetic fixtures only and listens on loopback.
    & (Join-Path $binPath 'initdb.exe') -D $dataPath -U postgres --auth=trust --encoding=UTF8 --locale=C *> (Join-Path $testRoot 'initdb.log')
    if ($LASTEXITCODE -ne 0) { throw "initdb failed; inspect $testRoot/initdb.log" }
    & (Join-Path $binPath 'pg_ctl.exe') -D $dataPath -l (Join-Path $testRoot 'server.log') -o "-h 127.0.0.1 -p $testPort" -w start
    if ($LASTEXITCODE -ne 0) { throw "PostgreSQL startup failed; inspect $testRoot/server.log" }
    $started = $true
    $env:TEST_PILOT_DATABASE_URL = "postgresql://postgres@127.0.0.1:$testPort/postgres"
    $env:TEST_RUNTIME_DATABASE_URL = $env:TEST_PILOT_DATABASE_URL
    if ($AllApiTests) {
        & npm.cmd run test -- --runInBand --silent
    } else {
        & npm.cmd run test -- --runInBand --silent --runTestsByPath src/modules/pilot/pilot.postgres.spec.ts src/modules/rides/application/publication.postgres.spec.ts src/modules/ride-runtime/application/runtime.integration.spec.ts
    }
    if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL tests failed' }
} finally {
    $env:TEST_PILOT_DATABASE_URL = $previousPilotUrl
    $env:TEST_RUNTIME_DATABASE_URL = $previousRuntimeUrl
    if ($started -or (Test-Path -LiteralPath (Join-Path $dataPath 'postmaster.pid'))) {
        & (Join-Path $binPath 'pg_ctl.exe') -D $dataPath -m fast -w stop
    }
    Pop-Location
}
