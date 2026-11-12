# TandemBridge installer for Windows.
#
#   irm https://raw.githubusercontent.com/AhmedRaza186/TandemBridge/main/install.ps1 | iex
#
# Read it first: it checks for Node.js 22+ and git (and offers to install them with winget),
# clones TandemBridge into %USERPROFILE%\TandemBridge, installs its packages, and runs its tests.
# Run it again to update: it pulls the latest code and never touches .env, your profile, or data\.
#
# Optional settings, as environment variables:
#   TANDEMBRIDGE_HOME  where to install (default: %USERPROFILE%\TandemBridge)
#   TANDEMBRIDGE_REPO  the git repository to clone
#   TANDEMBRIDGE_YES=1 install missing tools without asking

function Install-TandemBridge {
  # Native tools write warnings to stderr; success is judged by their exit codes instead.
  $ErrorActionPreference = 'Continue'
  $repo = if ($env:TANDEMBRIDGE_REPO) { $env:TANDEMBRIDGE_REPO } else { 'https://github.com/AhmedRaza186/TandemBridge.git' }
  $home_ = if ($env:TANDEMBRIDGE_HOME) { $env:TANDEMBRIDGE_HOME } else { Join-Path $env:USERPROFILE 'TandemBridge' }

  function Say($text, $color = 'Gray') { Write-Host $text -ForegroundColor $color }
  function Step($text) { Write-Host ''; Write-Host "> $text" -ForegroundColor Cyan }

  # A tool winget just installed is not on this window's PATH until it is read again.
  function Refresh-Path {
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = "$machine;$user"
  }

  function Ask($question) {
    if ($env:TANDEMBRIDGE_YES -eq '1') { return $true }
    $answer = Read-Host "$question [y/N]"
    return $answer -match '^(y|yes|haan|ha)$'
  }

  function Get-NodeMajor {
    try { return [int]((& node -v) -replace '^v(\d+).*', '$1') } catch { return 0 }
  }

  function Ensure-Tool($name, $ok, $wingetId) {
    if (& $ok) { return $true }
    Say "$name is missing." Yellow
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
      Say "Install $name yourself, then run this again." Red
      return $false
    }
    if (-not (Ask "Install $name with winget now?")) {
      Say "Install $name yourself, then run this again." Red
      return $false
    }
    & winget install --id $wingetId -e --accept-source-agreements --accept-package-agreements
    Refresh-Path
    if (& $ok) { return $true }
    Say "$name was installed, but this window cannot see it yet. Open a new PowerShell window and run this again." Yellow
    return $false
  }

  Say ''
  Say 'TandemBridge installer' White

  Step 'Checking Node.js 22+ and git'
  if (-not (Ensure-Tool 'Node.js 22 or newer' { (Get-NodeMajor) -ge 22 } 'OpenJS.NodeJS.LTS')) { return }
  if (-not (Ensure-Tool 'git' { [bool](Get-Command git -ErrorAction SilentlyContinue) } 'Git.Git')) { return }
  Say "Node $(& node -v), $(& git --version)"

  if (Test-Path (Join-Path $home_ '.git')) {
    Step "Updating $home_"
    & git -C $home_ pull --ff-only
    if ($LASTEXITCODE -ne 0) { Say 'Could not update: the folder has changes of its own. Nothing was changed.' Red; return }
  } elseif ((Test-Path $home_) -and (Get-ChildItem $home_ -Force | Select-Object -First 1)) {
    Say "$home_ already exists and is not a TandemBridge folder. Set TANDEMBRIDGE_HOME to another folder." Red
    return
  } else {
    Step "Downloading into $home_"
    & git clone $repo $home_
    if ($LASTEXITCODE -ne 0) { Say 'Download failed.' Red; return }
  }

  Push-Location $home_
  try {
    Step 'Installing packages'
    & npm ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { Say 'npm could not install the packages.' Red; return }
    & npm run --silent migrate
    if ($LASTEXITCODE -ne 0) { Say 'Could not create the database.' Red; return }

    Step 'Running the tests (about a minute)'
    $result = & npm test 2>&1 | Select-String -Pattern '^# (pass|fail) '
    $failed = $result | Where-Object { $_ -match '^# fail [1-9]' }
    if ($failed) { Say "Some tests failed: $($result -join ', '). Run npm test in $home_ to see why." Yellow }
    else { Say "Tests: $($result -join ', ')" Green }
  } finally {
    Pop-Location
  }

  Say ''
  Say 'TandemBridge is installed.' Green
  Say ''
  Say 'Next:'
  Say "  1. Open your AI agent (Claude Code, Codex, Copilot, Antigravity, Gemini CLI...) in:"
  Say "       $home_" White
  Say '  2. Ask it: "Follow docs/SETUP.md"  (in Claude Code you can type /setup)'
  Say '     It asks your language, which agents do which job, and where you want alerts.'
  Say '  3. Then keep "npm run bridge -- run" open in a terminal and describe what you want built.'
}

Install-TandemBridge
