// Çalışma kipi (Agent / Ask / Plan), izin modundan ayrıdır:
//   agent: yapay zekâ dosya değiştirebilir ve komut çalıştırabilir (izin modu ne derse o)
//   ask:   yalnızca yanıtlar; dosya değiştiren araçlar Atölye tarafından reddedilir
//   plan:  hiçbir şeyi değiştirmeden plan çıkarır; dosya değiştiren araçlar reddedilir
export const WORK_MODES = ['agent', 'ask', 'plan'];
export const validWork = (w) => (WORK_MODES.includes(w) ? w : 'agent');

/** Dosya değiştiren araçlar (Claude Code) */
export const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

/** Ask / Plan kipinde yapay zekâya giden mesaja eklenen yönerge (ekranda görünmez) */
export function workInstruction(work) {
  if (work === 'ask') return 'Ask mode: answer the user\'s question and explain. Read files and use read-only tools as needed, but do not modify files, do not run commands that change anything, and do not commit or push. If a change seems necessary, describe it and tell the user to switch to Agent mode.';
  if (work === 'plan') return 'Plan mode: do not change anything yet. Investigate with read-only actions as needed, then write a clear step-by-step plan (files to change, approach, risks, tests) and wait. The user switches to Agent mode to apply it.';
  return '';
}

export const denyMessage = (work) => (work === 'plan'
  ? 'Plan mode: files are not changed. Write the plan instead; the user will switch to Agent mode to apply it.'
  : 'Ask mode: files are not changed. Describe the change instead; the user can switch to Agent mode to apply it.');
