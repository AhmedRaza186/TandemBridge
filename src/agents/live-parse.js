// Reads a live log (written by live.js) back into what a viewer draws: `watch` and the
// Antigravity extension both use it. Plain functions only, so the extension can ship a copy.

// Tool names from agy and Claude Code, as a verb and a kind the viewer can mark.
const TOOLS = {
  write_file: ['Wrote', 'write'], Write: ['Wrote', 'write'],
  replace_file_content: ['Edited', 'write'], multi_replace_file_content: ['Edited', 'write'], edit_file: ['Edited', 'write'],
  Edit: ['Edited', 'write'], MultiEdit: ['Edited', 'write'], NotebookEdit: ['Edited', 'write'],
  view_file: ['Read', 'read'], read_file: ['Read', 'read'], Read: ['Read', 'read'], list_dir: ['Listed', 'read'],
  find_by_name: ['Searched', 'search'], grep_search: ['Searched', 'search'], Glob: ['Searched', 'search'], Grep: ['Searched', 'search'],
  run_command: ['Ran', 'run'], command_status: ['Checked', 'run'], Bash: ['Ran', 'run'], PowerShell: ['Ran', 'run'],
  read_url_content: ['Opened', 'web'], WebFetch: ['Opened', 'web'], search_web: ['Searched the web', 'web'], WebSearch: ['Searched the web', 'web'],
  TodoWrite: ['Planned', 'other']
};
const tool = (name) => {
  const [label, kind] = TOOLS[name] || [name.replace(/_/g, ' '), 'other'];
  return { label, tool: kind };
};

function parseLog(text) {
  const out = { title: '', agent: '', model: '', started: null, folder: '', tokens: 0, items: [], ended: false };
  let speaking = false;
  let blank = false;
  const last = () => out.items[out.items.length - 1];
  for (const line of String(text).replace(/\r/g, '').split('\n')) {
    const afterBlank = blank;
    blank = line === '';
    if (speaking) {
      if (line === '') { speaking = false; continue; }
      last().text += `\n${line}`;
      continue;
    }
    let m;
    if (!out.title && (m = /^TandemBridge step: (.*)$/.exec(line))) out.title = m[1];
    else if (!out.agent && (m = /^By: (.*?)(?: · (.*))?$/.exec(line))) { out.agent = m[1]; out.model = m[2] || ''; }
    else if (!out.started && (m = /^Started: (\S+)$/.exec(line))) out.started = Date.parse(m[1]) || null;
    else if (!out.folder && (m = /^Folder: (.*)$/.exec(line))) out.folder = m[1];
    else if (/^-{20,}$/.test(line) || line === '') continue;
    else if ((m = /^~ tokens (\d+)$/.exec(line))) out.tokens = Number(m[1]);
    else if ((m = /^Agent: ?(.*)$/.exec(line))) { out.items.push({ kind: 'agent', text: m[1] }); speaking = true; }
    else if ((m = /^> (\S+)(?: {2}(.*))?$/.exec(line))) out.items.push({ kind: 'tool', ...tool(m[1]), text: m[2] || '' });
    else if ((m = /^x (\S+) failed(?:: (.*))?$/.exec(line))) out.items.push({ kind: 'error', label: `${tool(m[1]).label} failed`, text: m[2] || '' });
    else if ((m = /^Finished: (.*)$/.exec(line))) {
      out.items.push({ kind: 'done', text: m[1] });
      const t = /(\d+) tokens/.exec(m[1]);
      if (t) out.tokens = Number(t[1]);
    } else if (line === '[end]') out.ended = true;
    // A later paragraph of the agent's message. A tool line still ends it: one always follows a blank line.
    else if (last() && last().kind === 'agent') last().text += `${afterBlank ? '\n\n' : '\n'}${line}`;
    else out.items.push({ kind: 'note', text: line });
  }
  return out;
}

module.exports = { parseLog };
