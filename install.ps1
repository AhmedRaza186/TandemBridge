# TandemBridge installer for Windows.
#
#   irm https://raw.githubusercontent.com/AhmedRaza186/TandemBridge/main/install.ps1 | iex
#
# Read it first: it checks for Node.js 22+ and git (and offers to install them with winget),
# asks which drive or folder to put TandemBridge in (a list, browsing the folders, or a typed path),
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

  # A menu picked with the arrow keys and Enter (or a number key). Esc returns -1.
  # Where keys cannot be read (input piped in), it falls back to typing a number.
  function Select-Menu($items, $default = 0) {
    $interactive = $true
    try { if ([Console]::IsInputRedirected) { $interactive = $false } } catch { $interactive = $false }
    if (-not $interactive) {
      for ($n = 0; $n -lt $items.Count; $n++) { Say ("  {0}. {1}" -f ($n + 1), $items[$n]) }
      $answer = (Read-Host "Your choice [$($default + 1)]").Trim()
      if ($answer -eq '') { return $default }
      if ($answer -match '^\d+$' -and [int]$answer -ge 1 -and [int]$answer -le $items.Count) { return [int]$answer - 1 }
      return -1
    }
    Say '  (arrow keys to move, Enter to choose, Esc to skip)' DarkGray
    $width = [Math]::Max(20, [Console]::WindowWidth - 1)
    foreach ($item in $items) { Write-Host '' }
    $top = [Console]::CursorTop - $items.Count
    $i = $default
    $cursor = [Console]::CursorVisible
    [Console]::CursorVisible = $false
    try {
      while ($true) {
        for ($n = 0; $n -lt $items.Count; $n++) {
          [Console]::SetCursorPosition(0, $top + $n)
          $line = if ($n -eq $i) { "  > $($items[$n])" } else { "    $($items[$n])" }
          if ($line.Length -gt $width) { $line = $line.Substring(0, $width) }
          if ($n -eq $i) { Write-Host $line.PadRight($width) -ForegroundColor Cyan -NoNewline }
          else { Write-Host $line.PadRight($width) -ForegroundColor Gray -NoNewline }
        }
        $key = [Console]::ReadKey($true)
        switch ($key.Key) {
          'UpArrow' { $i = ($i - 1 + $items.Count) % $items.Count }
          'DownArrow' { $i = ($i + 1) % $items.Count }
          'Home' { $i = 0 }
          'End' { $i = $items.Count - 1 }
          'Enter' { return $i }
          'Escape' { return -1 }
          default {
            $c = [string]$key.KeyChar
            if ($c -match '^[1-9]$' -and [int]$c -le $items.Count) { $i = [int]$c - 1 }
          }
        }
      }
    } finally {
      [Console]::SetCursorPosition(0, $top + $items.Count)
      [Console]::CursorVisible = $cursor
      Write-Host ''
    }
  }

  # Walks the folders inside the terminal: a drive, then folders in and out, then "Install here".
  # (The Windows folder window opens behind the terminal, so it is not used.) $null on Esc.
  function Browse-Folder {
    $dir = $null
    while ($true) {
      if (-not $dir) {
        $roots = @(Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Root -and (Test-Path $_.Root) } | ForEach-Object { $_.Root })
        Step 'Choose a drive'
        $pick = Select-Menu $roots 0
        if ($pick -lt 0) { return $null }
        $dir = $roots[$pick]
        continue
      }
      # Hidden and system folders ($Recycle.Bin, System Volume Information) are left out.
      $subs = @(Get-ChildItem -LiteralPath $dir -Directory -Force -ErrorAction SilentlyContinue |
        Where-Object { -not ($_.Attributes -band [IO.FileAttributes]::Hidden) -and -not ($_.Attributes -band [IO.FileAttributes]::System) } |
        Sort-Object Name)
      $height = 30
      try { $height = [Console]::WindowHeight } catch { }
      $max = [Math]::Max(5, $height - 12)
      $items = @("Install here:  $(Join-Path $dir 'TandemBridge')", '.. (up one folder)')
      $items += @($subs | Select-Object -First $max | ForEach-Object { "$($_.Name)\" })
      if ($subs.Count -gt $max) { $items += "($($subs.Count - $max) more folders: use Type a path instead)" }
      Step "Folder: $dir"
      $pick = Select-Menu $items 0
      if ($pick -lt 0) { return $null }
      if ($pick -eq 0) { return $dir }
      if ($pick -eq 1) {
        $parent = Split-Path $dir -Parent
        $dir = if ($parent) { $parent } else { $null }
        continue
      }
      if ($pick - 2 -lt [Math]::Min($subs.Count, $max)) { $dir = $subs[$pick - 2].FullName }
    }
  }

  # Where to install: a drive from the list, a folder picked by walking the folders, or a typed path.
  # The choice is remembered (TANDEMBRIDGE_HOME), so running this again updates the same folder.
  function Choose-Home {
    if ($env:TANDEMBRIDGE_HOME) { return $env:TANDEMBRIDGE_HOME }
    $default = Join-Path $env:USERPROFILE 'TandemBridge'
    if ($env:TANDEMBRIDGE_YES -eq '1') { return $default }

    $paths = @($default)
    $drives = Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' -ErrorAction SilentlyContinue
    foreach ($d in $drives) {
      if ($d.DeviceID -ne $env:SystemDrive) { $paths += "$($d.DeviceID)\TandemBridge" }
    }
    $items = @()
    for ($n = 0; $n -lt $paths.Count; $n++) {
      $disk = $drives | Where-Object { $_.DeviceID -eq $paths[$n].Substring(0, 2) }
      $free = if ($disk) { '   {0:N0} GB free' -f ($disk.FreeSpace / 1GB) } else { '' }
      $items += "$($paths[$n])$free"
    }
    $items += 'Browse for a folder...'
    $items += 'Type a path...'

    while ($true) {
      Step 'Where should TandemBridge go?'
      $pick = Select-Menu $items 0
      if ($pick -lt 0) { return $default }
      if ($pick -lt $paths.Count) { return $paths[$pick] }
      if ($pick -eq $paths.Count) {
        $picked = Browse-Folder
        if ($picked) {
          # A folder that already holds other things gets a TandemBridge folder inside it.
          $target = if ((Split-Path $picked -Leaf) -eq 'TandemBridge') { $picked } else { Join-Path $picked 'TandemBridge' }
          Say "Chosen: $target"
          return $target
        }
        continue
      }
      $typed = (Read-Host 'Full path, for example D:\Tools\TandemBridge').Trim().Trim('"')
      if ($typed -match '^[a-zA-Z]:\\') { return $typed }
      Say 'That is not a full path like D:\TandemBridge.' Yellow
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
    $items = @($options | ForEach-Object { $_.Name }) + 'Not now'
    $pick = Select-Menu $items 0
    if ($pick -lt 0 -or $pick -ge $options.Count) { return }
    $o = $options[$pick]
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
