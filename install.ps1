# TandemBridge installer for Windows.
#
#   irm https://raw.githubusercontent.com/AhmedRaza186/TandemBridge/main/install.ps1 | iex
#
# Read it first: it checks for Node.js 22+ and git (and offers to install them with winget),
# asks which drive or folder to put TandemBridge in (a list, a folder window, or a typed path),
# downloads it there, installs its packages, and runs its tests.
# Run it again to update: it pulls the latest code into the same folder and never touches .env,
# your profile, or data\.
#
# Optional settings, as environment variables:
#   TANDEMBRIDGE_HOME  where to install, without asking (a folder you choose is remembered here)
#   TANDEMBRIDGE_REPO  the git repository to clone
#   TANDEMBRIDGE_YES=1 install missing tools without asking

function Install-TandemBridge {
  # Native tools write warnings to stderr; success is judged by their exit codes instead.
  $ErrorActionPreference = 'Continue'
  $repo = if ($env:TANDEMBRIDGE_REPO) { $env:TANDEMBRIDGE_REPO } else { 'https://github.com/AhmedRaza186/TandemBridge.git' }
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

  # The folder chooser of Windows. Returns $null if it cannot open or nothing was picked.
  function Browse-Folder {
    try {
      Add-Type -AssemblyName System.Windows.Forms
      $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
      $dialog.Description = 'Choose where to put the TandemBridge folder'
      $dialog.ShowNewFolderButton = $true
      if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { return $dialog.SelectedPath }
    } catch { Say 'The folder window could not open here. Type the path instead.' Yellow }
    return $null
  }

  # Where to install: a drive from the list, a folder picked in the window, or a typed path.
  # The choice is remembered (TANDEMBRIDGE_HOME), so running this again updates the same folder.
  function Choose-Home {
    if ($env:TANDEMBRIDGE_HOME) { return $env:TANDEMBRIDGE_HOME }
    $default = Join-Path $env:USERPROFILE 'TandemBridge'
    if ($env:TANDEMBRIDGE_YES -eq '1') { return $default }

    $choices = @($default)
    $drives = Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' -ErrorAction SilentlyContinue
    foreach ($d in $drives) {
      if ($d.DeviceID -ne $env:SystemDrive) { $choices += "$($d.DeviceID)\TandemBridge" }
    }
    Step 'Where should TandemBridge go?'
    for ($i = 0; $i -lt $choices.Count; $i++) {
      $drive = $choices[$i].Substring(0, 2)
      $disk = $drives | Where-Object { $_.DeviceID -eq $drive }
      $free = if ($disk) { '{0:N0} GB free' -f ($disk.FreeSpace / 1GB) } else { '' }
      $tag = if ($i -eq 0) { ' (default)' } else { '' }
      Say ("  {0}. {1}{2}   {3}" -f ($i + 1), $choices[$i], $tag, $free)
    }
    Say '  B. Browse for a folder...'
    Say '  Or type a full path, for example D:\Tools\TandemBridge'
    while ($true) {
      $answer = (Read-Host 'Your choice [1]').Trim().Trim('"')
      if ($answer -eq '') { return $default }
      if ($answer -match '^\d+$' -and [int]$answer -ge 1 -and [int]$answer -le $choices.Count) { return $choices[[int]$answer - 1] }
      if ($answer -match '^[bB]$') {
        $picked = Browse-Folder
        if ($picked) {
          # A folder that already holds other things gets a TandemBridge folder inside it.
          $target = if ((Split-Path $picked -Leaf) -eq 'TandemBridge') { $picked } else { Join-Path $picked 'TandemBridge' }
          Say "Chosen: $target"
          return $target
        }
        continue
      }
      if ($answer -match '^[a-zA-Z]:\\') { return $answer }
      Say 'Type a number, B, or a full path like D:\TandemBridge.' Yellow
    }
  }

  # The first of these paths that exists, or the command if it is on PATH.
  function Find-Tool($command, $paths) {
    foreach ($p in $paths) { if ($p -and (Test-Path $p)) { return $p } }
    $c = Get-Command $command -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($c) { return $c.Source }
    return $null
  }

  # Offers to open the new folder in an IDE, or in a new terminal with an agent asked to start setup.
  function Open-With($folder) {
    if ($env:TANDEMBRIDGE_YES -eq '1') { return }
    $local = $env:LOCALAPPDATA
    $prompt = 'Follow docs/SETUP.md'
    $options = @()
    $ides = @(
      @('VS Code', 'code', @("$local\Programs\Microsoft VS Code\bin\code.cmd")),
      @('Antigravity', 'antigravity-ide', @("$local\Programs\Antigravity IDE\bin\antigravity-ide.cmd", "$local\Programs\Antigravity\bin\antigravity.cmd")),
      @('Cursor', 'cursor', @("$local\Programs\cursor\resources\app\bin\cursor.cmd"))
    )
    foreach ($ide in $ides) {
      $bin = Find-Tool $ide[1] $ide[2]
      if ($bin) { $options += [pscustomobject]@{ Name = "$($ide[0]) (IDE)"; Bin = $bin; Args = @($prompt); Kind = 'ide' } }
    }
    # Agents that run in a terminal, with how each one takes a first message.
    $agents = @(
      @('Claude Code', 'claude', @(), @($prompt)),
      @('Codex', 'codex', @(), @($prompt)),
      @('Gemini CLI', 'gemini', @(), @('-i', $prompt)),
      @('Antigravity CLI', 'agy', @("$env:USERPROFILE\.gemini\bin\agy.exe"), @('-i', $prompt)),
      @('GitHub Copilot CLI', 'copilot', @(), @())
    )
    foreach ($a in $agents) {
      $bin = Find-Tool $a[1] $a[2]
      if ($bin) { $options += [pscustomobject]@{ Name = "$($a[0]) (terminal)"; Bin = $bin; Args = $a[3]; Kind = 'cli' } }
    }
    if (-not $options.Count) { return }

    Step 'Open it now to start setup?'
    for ($i = 0; $i -lt $options.Count; $i++) { Say ("  {0}. {1}" -f ($i + 1), $options[$i].Name) }
    Say '  Enter. Not now'
    $answer = (Read-Host 'Your choice').Trim()
    if ($answer -notmatch '^\d+$' -or [int]$answer -lt 1 -or [int]$answer -gt $options.Count) { return }
    $o = $options[[int]$answer - 1]
    if ($o.Kind -eq 'ide') {
      Start-Process -FilePath $o.Bin -ArgumentList "`"$folder`"" -WindowStyle Hidden
      Say "Opened in $($o.Name). In its agent chat, type: $prompt" Green
    } else {
      # A new PowerShell window in the folder, with the agent already asked to start setup.
      $quoted = ($o.Args | ForEach-Object { "'" + ($_ -replace "'", "''") + "'" }) -join ' '
      $cmd = "Set-Location -LiteralPath '$($folder -replace "'", "''")'; & '$($o.Bin -replace "'", "''")' $quoted"
      Start-Process powershell.exe -ArgumentList '-NoExit', '-Command', $cmd -WorkingDirectory $folder
      if ($o.Args.Count) { Say "Opened $($o.Name) in a new window. It starts with: $prompt" Green }
      else { Say "Opened $($o.Name) in a new window. Type: $prompt" Green }
    }
  }

  Say ''
  Say 'TandemBridge installer' White

  $given = [bool]$env:TANDEMBRIDGE_HOME
  $home_ = Choose-Home
  if (-not (Test-Path (Split-Path $home_ -Qualifier))) { Say "Drive $(Split-Path $home_ -Qualifier) does not exist." Red; return }
  # A folder chosen here is remembered for this user, so the next run updates the same folder.
  if (-not $given) { [Environment]::SetEnvironmentVariable('TANDEMBRIDGE_HOME', $home_, 'User') }

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
  Open-With $home_
  Say ''
  Say 'Next:'
  Say "  1. Open your AI agent (Claude Code, Codex, Copilot, Antigravity, Gemini CLI...) in:"
  Say "       $home_" White
  Say '  2. Ask it: "Follow docs/SETUP.md"  (in Claude Code you can type /setup)'
  Say '     It asks your language, which agents do which job, and where you want alerts.'
  Say '  3. Then keep "npm run bridge -- run" open in a terminal and describe what you want built.'
}

Install-TandemBridge
