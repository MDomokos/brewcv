import { t } from '../i18n/index.js';
import { lockedOnDelete } from '../model/career.js';
import { lockedHolders } from '../model/lock.js';
import { resumeLabel } from '../model/resumes.js';

// A yes/no question. In the desktop app (Tauri) confirm() cannot be relied on: its web view does not show a blocking dialog, so a
// question that guards your data would be answered for you. There the native dialog is used, which is asynchronous.

export const inDesktop = () => !!globalThis.__TAURI__;   // prompt() is not available there either: a name is typed into a field on the page
export const desktopAsk = () => !!globalThis.__TAURI__?.dialog?.ask;

// `labels` ({ ok, cancel }) only where the question's own text names the buttons; otherwise the dialog says Yes and No.
export const askOk = async (msg, labels = null) => desktopAsk()
  ? globalThis.__TAURI__.dialog.ask(msg, { kind: 'warning', ...(labels ? { okLabel: labels.ok, cancelLabel: labels.cancel } : {}) })
  : confirm(msg);

// Before something changes in the record: when a resume holds a lock on it, the question names those resumes. No lock, no question.
const askNames = (state, key, find) => {
  const rs = [state.cur, ...(state.resumes ?? [])].filter(Boolean);
  const names = [...new Set(find(rs).map(i => resumeLabel(rs[i])))];
  return !names.length || askOk(t(key, { names: names.join(', ') }));
};
export const askIfLocked = async (state, remove) => askNames(state, 'ux6c.lockedOnAsk', rs => lockedOnDelete(state.record, rs, remove));
// the record's picture, removed or replaced: the resumes that show it under a lock
export const askPhotoLocked = async state => askNames(state, 'ux6c.lockedOnAskPhoto', rs => lockedHolders(state.record, rs, ['photo']).filter(i => rs[i].photo?.show));
