/**
 * Sending an e-mail from a contact or a deal. Attachments share the limits and
 * the allowed types of Jarvis's files (features/jarvis/files.ts): one server
 * already checks a file's real content against them, no need for a second set.
 */

export const EMAIL_SUBJECT_MAX = 200;
/** Same limit as contact_activities.content, since the sent text is logged there. */
export const EMAIL_BODY_MAX = 5000;

/** The text logged to contact_activities and offered as the "Email sent" table's answer. */
export function emailSummary(subject: string, body: string): string {
  const subjectLine = subject.trim();
  const bodyText = body.trim();
  const text = subjectLine ? `${subjectLine}\n\n${bodyText}` : bodyText;
  return text.slice(0, EMAIL_BODY_MAX);
}
