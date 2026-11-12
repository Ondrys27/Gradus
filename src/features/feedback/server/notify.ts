import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ADMIN_PATH } from "@/features/admin/access";
import { ownerContact } from "@/features/grady/server/owner";
import { sendEmail } from "@/lib/email/resend";
import type { Database } from "@/types/database";
import {
  reportFixedEmail,
  reportOwnerEmail,
  welcomeBetaEmail,
  type ReportMailData,
} from "./emails";

type Client = SupabaseClient<Database>;

/** Internal test accounts (e2e-…@gradus.local) never get mail: nothing would arrive. */
export function isTestAddress(email: string | null | undefined): boolean {
  return Boolean(email && /@gradus\.local$/i.test(email));
}

function reportAdminUrl(origin: string | null, id: string): string | null {
  return origin ? `${origin}${ADMIN_PATH}/zpetna-vazba?tab=reports&report=${id}` : null;
}

/** The owner's e-mail about every new report. Never throws. */
export async function mailOwnerAboutReport(
  admin: Client,
  data: Omit<ReportMailData, "adminUrl">,
  origin: string | null,
): Promise<void> {
  if (isTestAddress(data.user.email)) return;
  const owner = await ownerContact(admin);
  if (!owner.email) return;
  const mail = reportOwnerEmail(
    { ...data, adminUrl: reportAdminUrl(origin, data.id) },
    owner.locale,
  );
  const result = await sendEmail({ to: owner.email, ...mail });
  if (!result.ok) console.error("[report] owner e-mail failed", result.error);
}

/** The thank-you to the author of a report that became fixed. Never throws. */
export async function mailAuthorReportFixed(
  admin: Client,
  userId: string,
  origin: string | null,
): Promise<boolean> {
  const [user, settings] = await Promise.all([
    admin.auth.admin.getUserById(userId),
    admin.from("user_settings").select("locale").eq("user_id", userId).maybeSingle(),
  ]);
  const email = user.data.user?.email;
  if (!email || isTestAddress(email)) return false;
  const mail = reportFixedEmail(
    { appUrl: origin ? `${origin}/app` : null },
    settings.data?.locale ?? null,
  );
  const result = await sendEmail({ to: email, ...mail });
  if (!result.ok) console.error("[report] thank-you e-mail failed", result.error);
  return result.ok;
}

/** The welcome to a tester who registered with an invitation. Never throws. */
export async function mailWelcomeBeta(
  to: string,
  data: { name: string | null; origin: string | null; locale: string },
): Promise<boolean> {
  if (isTestAddress(to)) return false;
  const mail = welcomeBetaEmail(
    { name: data.name, appUrl: data.origin ? `${data.origin}/app` : null },
    data.locale,
  );
  const result = await sendEmail({ to, ...mail });
  if (!result.ok) console.error("[welcome] e-mail failed", result.error);
  return result.ok;
}
