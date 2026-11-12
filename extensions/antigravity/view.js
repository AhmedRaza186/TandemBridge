// The "TandemBridge" side panel: the live log of a step, shown as a conversation. The orchestrator's
// log format is plain text (see src/agents/live.js); parseLog turns it into items the panel draws.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// The packed extension carries its own copy of the parser; in this repo it is read from src.
let parseLog;
try { ({ parseLog } = require('./parse-log')); } catch (e) { ({ parseLog } = require('../../src/agents/live-parse')); }

// The page inside the panel (panel.html). Colors come from the IDE's theme, so it fits light and dark.
function html() {
  const nonce = crypto.randomBytes(16).toString('hex');
  return fs.readFileSync(path.join(__dirname, 'panel.html'), 'utf8').replace(/\{\{nonce\}\}/g, nonce);
}

module.exports = { parseLog, html };
