// Laptop-level helpers: battery reading and keeping the machine awake during a run.
const { execFile, spawn } = require('child_process');

function readBattery() {
  if (process.platform !== 'win32') return Promise.resolve(null);
  const cmd = 'Get-CimInstance Win32_Battery | Select-Object EstimatedChargeRemaining,BatteryStatus | ConvertTo-Json -Compress';
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd],
      { windowsHide: true, timeout: 30000 }, (err, stdout) => {
        if (err || !stdout.trim()) return resolve(null);          // desktop, or the reading failed
        try {
          const b = [].concat(JSON.parse(stdout))[0];
          // BatteryStatus 1 = discharging. Everything else counts as on mains.
          resolve({ percent: b.EstimatedChargeRemaining, charging: b.BatteryStatus !== 1 });
        } catch (e) { resolve(null); }
      });
  });
}

// Holds a system-awake request while a workflow runs. The helper exits by itself if the
// orchestrator dies, so it can never keep the laptop awake forever.
// Closing the lid is separate: Windows follows its own "lid close" power setting.
function createKeepAwake() {
  let child = null;
  const script =
    "Add-Type -Name P -Namespace W -MemberDefinition '[DllImport(\"kernel32.dll\")] public static extern uint SetThreadExecutionState(uint e);';" +
    `while (Get-Process -Id ${process.pid} -ErrorAction SilentlyContinue) {` +
    '[W.P]::SetThreadExecutionState(2147483649) | Out-Null; Start-Sleep -Seconds 30 }';
  return {
    set(wanted) {
      if (process.platform !== 'win32') return;
      if (wanted && !child) {
        child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
          { windowsHide: true, stdio: 'ignore' });
        child.on('exit', () => { child = null; });
        child.on('error', () => { child = null; });
      } else if (!wanted && child) {
        child.kill();
      }
    },
    active: () => !!child
  };
}

module.exports = { readBattery, createKeepAwake };
