/** Text for an e-mail's HTML: every character that could start markup as an entity. */
export function escapeHtmlText(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}
