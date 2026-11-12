// How hard the agents may work, and so how fast they use the owner's tokens.
// The owner picks a level in bridge.profile.json ("limits": { "usage": "saver" }), and may
// override any single value there or in .env.
//
// Every Claude step runs on Opus 5.5 at medium effort: the strongest model, with effort kept at
// medium so a step does not think longer than it needs. The levels differ only in their guards.
// A level may still set its own model and effort per kind of step.
const OPUS_MEDIUM = ['claude-opus-5-5', 'medium'];
const claude = { implement: OPUS_MEDIUM, review: OPUS_MEDIUM, other: OPUS_MEDIUM };
const LEVELS = {
  saver: { taskBudgetUsd: 3, workflowBudgetUsd: 15, claude },
  balanced: { taskBudgetUsd: 6, workflowBudgetUsd: 30, claude },
  max: { taskBudgetUsd: 12, workflowBudgetUsd: 60, claude }
};

function usageLevel(name) {
  const level = LEVELS[name || 'balanced'];
  if (!level) throw new Error(`bridge.profile.json: limits.usage must be one of ${Object.keys(LEVELS).join(', ')}, not "${name}"`);
  return level;
}

// The model and effort for one Claude step. Test and document steps count as "other".
function claudeChoice(config, kind) {
  const slot = kind === 'implement' || kind === 'review' ? kind : 'other';
  const [model, effort] = config.usage ? config.usage.claude[slot] : [];
  return { model: config.claudeModel || model, effort: config.claudeEffort || effort };
}

module.exports = { LEVELS, usageLevel, claudeChoice };
