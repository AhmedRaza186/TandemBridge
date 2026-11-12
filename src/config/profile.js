// The owner's choices from /setup: who does what, limits, and the language of alerts.
const fs = require('fs');
const path = require('path');

const { AGENT_IDS: AGENTS } = require('../agents/registry');
const DEFAULTS = {
  owner: 'the owner',
  language: 'English',
  team: { manager: 'codex', backend: 'claude', frontend: 'antigravity', reviewer: 'claude' },
  limits: {},
  messages: {}
};

const fileOf = () => process.env.TANDEMBRIDGE_PROFILE || path.join(__dirname, '..', '..', 'bridge.profile.json');

function loadProfile() {
  const file = fileOf();
  const saved = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const profile = { ...DEFAULTS, ...saved, team: { ...DEFAULTS.team, ...saved.team }, limits: { ...saved.limits }, messages: { ...saved.messages } };
  for (const role of ['backend', 'frontend', 'reviewer']) {
    if (!AGENTS.includes(profile.team[role])) throw new Error(`${path.basename(file)}: team.${role} must be one of ${AGENTS.join(', ')}`);
  }
  return profile;
}

module.exports = { loadProfile };
