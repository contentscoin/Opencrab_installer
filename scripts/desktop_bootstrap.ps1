param(
  [string]$InstallDir = "",
  [string]$Mode = "install"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$UserDataDir = Join-Path $env:APPDATA "opencrab-desktop"
$LogPath = Join-Path $UserDataDir "install-bootstrap.log"
New-Item -ItemType Directory -Force -Path $UserDataDir | Out-Null

function Write-BootstrapLog {
  param([string]$Message)
  $line = "[{0}] {1}" -f (Get-Date).ToString("s"), $Message
  Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
  Write-Host $line
}

function Test-IsAdmin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Add-PathIfExists {
  param([string]$PathToAdd)
  if ($PathToAdd -and (Test-Path -LiteralPath $PathToAdd) -and ($env:Path -notlike "*$PathToAdd*")) {
    $env:Path = "$PathToAdd;$env:Path"
  }
}

function Resolve-ResourceDir {
  param([string]$BaseInstallDir)

  if ($BaseInstallDir) {
    $candidate = Join-Path $BaseInstallDir "resources"
    if (Test-Path -LiteralPath $candidate) {
      return (Resolve-Path -LiteralPath $candidate).Path
    }
  }

  $scriptRoot = Split-Path -Parent $PSCommandPath
  $candidate = Resolve-Path -LiteralPath (Join-Path $scriptRoot "..") -ErrorAction SilentlyContinue
  if ($candidate -and (Test-Path -LiteralPath (Join-Path $candidate.Path "docker-compose.yml"))) {
    return $candidate.Path
  }

  throw "Could not resolve OpenCrab resources directory."
}

function Get-ExecutablePath {
  param([string]$CommandName)
  $command = Get-Command $CommandName -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }
  return $null
}

function Invoke-External {
  param(
    [string]$FilePath,
    [string[]]$Arguments,
    [int[]]$SuccessCodes = @(0)
  )

  Write-BootstrapLog ("> {0} {1}" -f $FilePath, ($Arguments -join " "))
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $output = & $FilePath @Arguments 2>&1
    $exitCode = if ($LASTEXITCODE -ne $null) { [int]$LASTEXITCODE } else { 0 }
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  foreach ($line in $output) {
    if ($line) {
      Write-BootstrapLog ([string]$line)
    }
  }

  if ($SuccessCodes -notcontains $exitCode) {
    throw "Command failed with exit code ${exitCode}: $FilePath $($Arguments -join ' ')"
  }

  return $output
}

function Test-DockerReady {
  param([string]$DockerPath)
  try {
    & $DockerPath info *> $null
    return ($LASTEXITCODE -eq 0)
  } catch {
    return $false
  }
}

function Start-DockerDesktop {
  $candidates = @(
    (Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "Docker\Docker\Docker Desktop.exe"),
    (Join-Path $env:LOCALAPPDATA "Docker\Docker Desktop.exe")
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

  if ($candidates.Count -eq 0) {
    Write-BootstrapLog "Docker Desktop executable was not found."
    return
  }

  Write-BootstrapLog "Starting Docker Desktop..."
  Start-Process -FilePath $candidates[0] -WindowStyle Minimized | Out-Null
}

function Wait-DockerReady {
  param(
    [string]$DockerPath,
    [int]$TimeoutSeconds = 600
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-DockerReady -DockerPath $DockerPath) {
      Write-BootstrapLog "Docker is ready."
      return $true
    }
    Start-Sleep -Seconds 5
  }

  return $false
}

function Install-DockerDesktopIfNeeded {
  Add-PathIfExists (Join-Path $env:ProgramFiles "Docker\Docker\resources\bin")
  Add-PathIfExists (Join-Path $env:ProgramFiles "Docker\Docker")

  $docker = Get-ExecutablePath "docker"
  if ($docker) {
    Write-BootstrapLog "Docker CLI found: $docker"
    if (Test-DockerReady -DockerPath $docker) {
      Write-BootstrapLog "Docker daemon is already running."
      return $docker
    }

    Start-DockerDesktop
    if (Wait-DockerReady -DockerPath $docker) {
      return $docker
    }
  }

  $winget = Get-ExecutablePath "winget"
  if (-not $winget) {
    Write-BootstrapLog "winget was not found. Opening Docker Desktop download page."
    Start-Process "https://www.docker.com/products/docker-desktop/" | Out-Null
    throw "Docker Desktop is required. Install Docker Desktop, start it once, then run OpenCrab again."
  }

  Write-BootstrapLog "Docker Desktop is missing or not ready. Attempting install via winget."
  $wingetArgs = @(
    "install",
    "-e",
    "--id",
    "Docker.DockerDesktop",
    "--accept-package-agreements",
    "--accept-source-agreements",
    "--silent"
  )

  if (Test-IsAdmin) {
    $process = Start-Process -FilePath $winget -ArgumentList $wingetArgs -PassThru -Wait
  } else {
    $process = Start-Process -FilePath $winget -ArgumentList $wingetArgs -Verb RunAs -PassThru -Wait
  }

  Write-BootstrapLog "winget Docker Desktop installer exited with code $($process.ExitCode)."
  Add-PathIfExists (Join-Path $env:ProgramFiles "Docker\Docker\resources\bin")
  Add-PathIfExists (Join-Path $env:ProgramFiles "Docker\Docker")

  $docker = Get-ExecutablePath "docker"
  if (-not $docker) {
    throw "Docker CLI was not available after Docker Desktop installation."
  }

  Start-DockerDesktop
  if (-not (Wait-DockerReady -DockerPath $docker -TimeoutSeconds 900)) {
    throw "Docker Desktop was installed, but Docker did not become ready. A Windows restart or Docker Desktop first-run approval may be required."
  }

  return $docker
}

function Wait-ContainerHealthy {
  param(
    [string]$DockerPath,
    [string]$ContainerName,
    [int]$TimeoutSeconds = 300
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $lastStatus = ""
  while ((Get-Date) -lt $deadline) {
    $status = & $DockerPath inspect "--format={{.State.Health.Status}}" $ContainerName 2>&1
    if ($LASTEXITCODE -eq 0) {
      $lastStatus = [string]$status
      if ($lastStatus.Trim() -eq "healthy") {
        Write-BootstrapLog "$ContainerName is healthy."
        return
      }
    } else {
      $lastStatus = [string]$status
    }
    Start-Sleep -Seconds 3
  }

  throw "$ContainerName did not become healthy. Last status: $lastStatus"
}

function Set-OpenCrabRuntimeEnv {
  param([string]$ResourceDir)

  $env:COMPOSE_PROJECT_NAME = if ($env:OPENCRAB_DESKTOP_COMPOSE_PROJECT_NAME) { $env:OPENCRAB_DESKTOP_COMPOSE_PROJECT_NAME } else { "opencrab_local" }
  $env:STORAGE_MODE = "docker"
  $env:OPENCRAB_API_KEY = if ($env:OPENCRAB_API_KEY) { $env:OPENCRAB_API_KEY } else { "local-opencrab-key" }
  $env:OPENCRAB_TIER = if ($env:OPENCRAB_TIER) { $env:OPENCRAB_TIER } else { "free" }
  $env:NEO4J_HTTP_HOST_PORT = if ($env:NEO4J_HTTP_HOST_PORT) { $env:NEO4J_HTTP_HOST_PORT } else { "7475" }
  $env:NEO4J_BOLT_HOST_PORT = if ($env:NEO4J_BOLT_HOST_PORT) { $env:NEO4J_BOLT_HOST_PORT } else { "7688" }
  $env:MONGODB_HOST_PORT = if ($env:MONGODB_HOST_PORT) { $env:MONGODB_HOST_PORT } else { "27018" }
  $env:POSTGRES_HOST_PORT = if ($env:POSTGRES_HOST_PORT) { $env:POSTGRES_HOST_PORT } else { "5433" }
  $env:CHROMA_HOST_PORT = if ($env:CHROMA_HOST_PORT) { $env:CHROMA_HOST_PORT } else { "8002" }
  $env:NEO4J_URI = if ($env:NEO4J_URI) { $env:NEO4J_URI } else { "bolt://localhost:$($env:NEO4J_BOLT_HOST_PORT)" }
  $env:NEO4J_USER = if ($env:NEO4J_USER) { $env:NEO4J_USER } else { "neo4j" }
  $env:NEO4J_PASSWORD = if ($env:NEO4J_PASSWORD) { $env:NEO4J_PASSWORD } else { "opencrab" }
  $env:MONGODB_URI = if ($env:MONGODB_URI) { $env:MONGODB_URI } else { "mongodb://root:opencrab@localhost:$($env:MONGODB_HOST_PORT)/opencrab?authSource=admin" }
  $env:MONGODB_DB = if ($env:MONGODB_DB) { $env:MONGODB_DB } else { "opencrab" }
  $env:POSTGRES_URL = if ($env:POSTGRES_URL) { $env:POSTGRES_URL } else { "postgresql://opencrab:opencrab@localhost:$($env:POSTGRES_HOST_PORT)/opencrab" }
  $env:CHROMA_HOST = if ($env:CHROMA_HOST) { $env:CHROMA_HOST } else { "localhost" }
  $env:CHROMA_PORT = if ($env:CHROMA_PORT) { $env:CHROMA_PORT } else { $env:CHROMA_HOST_PORT }
  $env:PYTHONPATH = $ResourceDir
}

function Start-OpenCrabDataServices {
  param(
    [string]$DockerPath,
    [string]$ResourceDir
  )

  $composeFile = Join-Path $ResourceDir "docker-compose.yml"
  if (-not (Test-Path -LiteralPath $composeFile)) {
    throw "docker-compose.yml was not found at $composeFile"
  }

  Push-Location $ResourceDir
  try {
    try {
      Invoke-External -FilePath $DockerPath -Arguments @("compose", "-f", $composeFile, "up", "-d", "neo4j", "mongodb", "postgres", "chromadb") | Out-Null
    } catch {
      $dockerCompose = Get-ExecutablePath "docker-compose"
      if (-not $dockerCompose) {
        throw
      }
      Write-BootstrapLog "docker compose failed; trying docker-compose."
      Invoke-External -FilePath $dockerCompose -Arguments @("-f", $composeFile, "up", "-d", "neo4j", "mongodb", "postgres", "chromadb") | Out-Null
    }
  } finally {
    Pop-Location
  }

  Wait-ContainerHealthy -DockerPath $DockerPath -ContainerName "opencrab-neo4j"
  Wait-ContainerHealthy -DockerPath $DockerPath -ContainerName "opencrab-mongodb"
  Wait-ContainerHealthy -DockerPath $DockerPath -ContainerName "opencrab-postgres"
  Wait-ContainerHealthy -DockerPath $DockerPath -ContainerName "opencrab-chromadb"
}

function Invoke-InitialSeed {
  param([string]$ResourceDir)

  $markerPath = Join-Path $UserDataDir "initial-ingest.done"
  if (Test-Path -LiteralPath $markerPath) {
    Write-BootstrapLog "Initial OpenCrab seed already completed."
    return
  }

  $python = Join-Path $ResourceDir ".venv\Scripts\python.exe"
  $seedScript = Join-Path $ResourceDir "scripts\seed_ontology.py"
  if (-not (Test-Path -LiteralPath $python)) {
    Write-BootstrapLog "Python runtime was not found at $python; seed will run on first app launch."
    return
  }
  if (-not (Test-Path -LiteralPath $seedScript)) {
    Write-BootstrapLog "Seed script was not found at $seedScript; seed will run on first app launch."
    return
  }

  Push-Location $ResourceDir
  try {
    Invoke-External -FilePath $python -Arguments @($seedScript) | Out-Null
    Set-Content -LiteralPath $markerPath -Value (Get-Date).ToString("o") -Encoding UTF8
    Write-BootstrapLog "Initial OpenCrab seed completed."
  } finally {
    Pop-Location
  }
}

try {
  Clear-Content -LiteralPath $LogPath -ErrorAction SilentlyContinue
  Write-BootstrapLog "OpenCrab desktop bootstrap started. Mode=$Mode InstallDir=$InstallDir"
  $resourceDir = Resolve-ResourceDir -BaseInstallDir $InstallDir
  Write-BootstrapLog "Resource directory: $resourceDir"
  Set-OpenCrabRuntimeEnv -ResourceDir $resourceDir
  $docker = Install-DockerDesktopIfNeeded
  Start-OpenCrabDataServices -DockerPath $docker -ResourceDir $resourceDir
  Invoke-InitialSeed -ResourceDir $resourceDir
  Write-BootstrapLog "OpenCrab desktop bootstrap completed successfully."
  exit 0
} catch {
  Write-BootstrapLog "OpenCrab desktop bootstrap failed: $($_.Exception.Message)"
  exit 1
}
