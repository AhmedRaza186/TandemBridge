// Every alert the owner can receive. English here; /setup writes translations to the profile.
const { loadProfile } = require('../config/profile');

const MESSAGES = {
  test_subject: 'Test alert',
  test_body: 'A test message from TandemBridge. If you can read this, alerts are working.',
  ignored_subject: 'Please check: {agent} changed {count} ignored file(s)',
  ignored_body: 'Step {seq} ({agent}) changed these files outside its folders. Git does not track them:\n{files}\n\nThe work was not stopped. Please check them yourself.',
  review_limit: 'Review rounds are used up, and these fixes remain:\n{fixes}\n\nReview summary: {summary}\n\nReply "fix them" (runs one more round) or "accept as is" (ends the work here).',
  blocked_subject: 'Your answer needed: {title}',
  blocked_body: '{agent} stopped at step {seq}.\n\nQuestion: {question}\n\nTo answer:\nnpm run bridge -- answer {id} "your answer"',
  budget_subject: 'Budget limit: {title}',
  budget_body: 'This workflow reached its usage guard (${spent} of ${budget}).\nTo continue:\nnpm run bridge -- resume {id} --budget 10',
  budget_warn_subject: 'Usage at 80%: {title}',
  budget_warn_body: 'This workflow has used ${spent} of its ${budget} usage guard. It keeps running, and pauses at the guard.\nTo stop it now:\nnpm run bridge -- cancel {id}',
  paused_subject: '{agent} stopped: {title}',
  paused_quota: '{agent} seems to be out of tokens or at a limit.\nStep {seq}. The system will retry every {minutes} minutes.\n\nDetail: {error}',
  paused_network: '{agent} cannot be reached over the network.\nStep {seq}. The system will retry by itself.\n\nDetail: {error}',
  paused_auth: '{agent} login has expired. Run "{login}" and log in, then:\nnpm run bridge -- resume {id}\n\nDetail: {error}',
  paused_budget: 'This step reached its budget limit.\nRaise it in the config, then:\nnpm run bridge -- resume {id}\n\nDetail: {error}',
  finished_failed_subject: 'Work stopped, step {seq} failed: {title}',
  finished_ok_subject: 'Work complete: {title}',
  finished_run: 'How to run it:\n{instructions}\n\n',
  finished_footer: 'Nothing was pushed or deployed.',
  battery_ok_subject: 'Charger connected, work has resumed',
  battery_ok_body: 'Battery {percent}%. New tasks have started again.',
  battery_critical_subject: 'URGENT: battery {percent}%',
  battery_critical_body: 'The laptop is about to shut down. New tasks are on hold. Please plug in the charger.\nWorkflow: {title}',
  battery_low_subject: 'Battery low: {percent}%',
  battery_low_body: 'Work is running. Please plug in the charger.\nWorkflow: {title}',
  backup_failed_subject: 'Backup failed',
  backup_failed_body: 'The database could not be copied to {dir}. Work continues, but there is no fresh backup.\n\nDetail: {error}',
  downtime_subject: 'System was offline',
  downtime_body: 'The orchestrator was off from {since} until now (laptop off, asleep, or a crash). Work has resumed from where it stopped.\nWorkflow: {title}'
};

// One pass only, so a brace inside an error message or a question is left as written.
function t(key, vars = {}) {
  const text = loadProfile().messages[key] || MESSAGES[key];
  return text.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m));
}

module.exports = { MESSAGES, t };
