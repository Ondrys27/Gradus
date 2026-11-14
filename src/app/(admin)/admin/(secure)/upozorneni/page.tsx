import { permanentRedirect } from "next/navigation";
import { ADMIN_PATH } from "@/features/admin/access";

/**
 * The e-mails about errors are the second tab of Operations → Errors since
 * step 27.2; old links (and e-mails sent before) land there.
 */
export default async function AdminErrorAlertsRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const item of Array.isArray(value) ? value : value ? [value] : []) params.append(key, item);
  }
  params.set("tab", "alerts");
  permanentRedirect(`${ADMIN_PATH}/chyby?${params.toString()}`);
}
