"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/features/account/queries";
import { contactKeys } from "@/features/contacts/queries";
import {
  ACCEPTED_EXTENSIONS,
  MAX_FILE_BYTES,
  MAX_FILES_PER_MESSAGE,
} from "@/features/jarvis/files";
import { JarvisJobError, postJarvisJob } from "@/features/jarvis/queries";
import { pipelineKeys } from "@/features/pipeline/queries";
import { createClient } from "@/lib/supabase/client";
import { sendEmailAction, type SendEmailInput } from "./actions";
import { EmailError, unwrap } from "./errors";
import { track } from "@/lib/analytics/client";

const ATTACHMENTS_BUCKET = "attachments";

/** Same allowances as Jarvis's own files; one set of limits for the whole app. */
export { ACCEPTED_EXTENSIONS, MAX_FILE_BYTES, MAX_FILES_PER_MESSAGE as MAX_EMAIL_ATTACHMENTS };

export type EmailAttachmentRef = { path: string; name: string };

/** Uploads a file to the user's own folder; the action checks its content before sending. */
export async function uploadEmailFile(userId: string, file: File): Promise<EmailAttachmentRef> {
  const path = `${userId}/email/${crypto.randomUUID()}`;
  const { error } = await createClient()
    .storage.from(ATTACHMENTS_BUCKET)
    .upload(path, file, { upsert: false });
  if (error) throw error;
  return { path, name: file.name };
}

/** Removes uploads that were never sent (the send failed before the action took them). */
export async function removeEmailFiles(paths: string[]) {
  if (!paths.length) return;
  await createClient().storage.from(ATTACHMENTS_BUCKET).remove(paths);
}

export type SendEmailArgs = {
  contactId: string;
  dealId: string | null;
  subject: string;
  body: string;
  files: File[];
  /** The body started from Jarvis's draft. */
  usedAiDraft?: boolean;
};

/**
 * Uploads any attachments, then sends the e-mail through the server action.
 * A failed action leaves no upload behind. On success, the contact's and the
 * deal's activity timelines read again.
 */
export function useSendEmail() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: SendEmailArgs) => {
      let attachments: EmailAttachmentRef[] = [];
      if (args.files.length) {
        try {
          attachments = await Promise.all(args.files.map((file) => uploadEmailFile(user.id, file)));
        } catch {
          throw new EmailError("fileMissing");
        }
      }
      const input: SendEmailInput = {
        contactId: args.contactId,
        dealId: args.dealId,
        subject: args.subject,
        body: args.body,
        attachments,
      };
      try {
        return unwrap(await sendEmailAction(input));
      } catch (error) {
        await removeEmailFiles(attachments.map((item) => item.path));
        throw error;
      }
    },
    onSuccess: (_data, args) => {
      track("email_sent", {
        attachments: args.files.length,
        used_ai_draft: args.usedAiDraft === true,
        from_deal: args.dealId !== null,
      });
      void queryClient.invalidateQueries({
        queryKey: contactKeys.activities(user.id, args.contactId),
      });
      void queryClient.invalidateQueries({ queryKey: contactKeys.lists(user.id) });
      if (args.dealId) {
        void queryClient.invalidateQueries({
          queryKey: pipelineKeys.dealActivities(user.id, args.dealId),
        });
      }
    },
  });
}

export { JarvisJobError as EmailReplyError };

/** Jarvis drafts a reply to a pasted-in e-mail; the user edits it before sending. */
export function useSuggestEmailReply() {
  return useMutation({
    mutationKey: ["jarvis", "email-reply"],
    mutationFn: async (args: {
      contactId: string;
      dealId: string | null;
      receivedEmail: string;
    }) => {
      const result = await postJarvisJob<{ reply: string }>({ kind: "emailReply", ...args });
      track("email_draft_requested", {
        ok: result.ok,
        ...(result.ok ? {} : { error_code: result.code }),
      });
      if (!result.ok) throw new JarvisJobError(result.code);
      return result.reply;
    },
  });
}
