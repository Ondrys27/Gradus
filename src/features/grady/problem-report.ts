/**
 * Grady never files bug reports (27.1): people would send him every swear
 * word and everything would land in the administration. When a message
 * wants to report a problem with the app or complains that something is
 * broken, Grady answers briefly and the chat shows a "Report a problem"
 * button under his answer, which opens the usual report form (page and
 * screenshot, never the chat text). Deterministic and shared by the server
 * (the note in the prompt) and the panel (the button), so both agree without
 * storing anything.
 */

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/** Czech and English, without diacritics. */
const HINTS = [
  /\bnahlas(it|im|te|il|ila|ili)?\b.{0,40}\b(chyb|problem|bug)/,
  /\b(chyb|problem|bug).{0,20}\bnahlas/,
  /\b(nefunguj|nejde mi|nejde to|nejdou|nenacita|nenaci|neuklad|nereaguj|zasekl|zasekava|spadl|spadla|spadlo|pada|zamrz)/,
  /\bchyb(a|u|ou|y)\b.{0,30}\b(v aplikaci|v appce|v gradusu|ve gradusu|na strance|v systemu|v menu|pri ukladani)/,
  /\bchybov(a|e|ou) (hlask|zprav)/,
  /\b(error|bug|bugy|crash)\b/,
  /\b(report|file) (a |the )?(bug|problem|issue|error)/,
  /\b(does ?n[o']?t|did ?n[o']?t|won'?t|can'?t|cannot) (work|load|save|open|sign in|log in)\b/,
  /\b(is|it'?s|seems) (broken|not working|stuck|frozen)\b/,
  /\bkeeps? crashing\b/,
];

export function mightBeProblemReport(message: string | null | undefined): boolean {
  if (!message) return false;
  const text = normalize(message);
  return HINTS.some((hint) => hint.test(text));
}
