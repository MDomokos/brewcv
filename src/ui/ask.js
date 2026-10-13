// A yes/no question. In the desktop app (Tauri) confirm() cannot be relied on: its web view does not show a blocking dialog, so a
// question that guards your data would be answered for you. There the native dialog is used, which is asynchronous.

export const inDesktop = () => !!globalThis.__TAURI__;   // prompt() is not available there either: a name is typed into a field on the page
export const desktopAsk = () => !!globalThis.__TAURI__?.dialog?.ask;

// `labels` ({ ok, cancel }) only where the question's own text names the buttons; otherwise the dialog says Yes and No.
export const askOk = async (msg, labels = null) => desktopAsk()
  ? globalThis.__TAURI__.dialog.ask(msg, { kind: 'warning', ...(labels ? { okLabel: labels.ok, cancelLabel: labels.cancel } : {}) })
  : confirm(msg);
