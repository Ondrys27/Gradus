type Messages = { [key: string]: string | Messages };

/**
 * Only the given parts of the messages, by dotted path (`"topBar.account"`).
 * The public website sends the browser its own texts, not the whole app's.
 */
export function pickMessages(messages: Messages, paths: readonly string[]): Messages {
  const picked: Messages = {};
  for (const path of paths) {
    const parts = path.split(".");
    let source: string | Messages | undefined = messages;
    for (const part of parts) {
      source = typeof source === "object" ? source[part] : undefined;
    }
    if (source === undefined) continue;
    let target = picked;
    parts.slice(0, -1).forEach((part) => {
      const next = target[part];
      target[part] = typeof next === "object" ? next : {};
      target = target[part] as Messages;
    });
    target[parts[parts.length - 1]!] = source;
  }
  return picked;
}
