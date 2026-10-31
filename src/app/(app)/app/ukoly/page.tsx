import { redirect } from "next/navigation";
import { TASKS_PATH } from "@/features/crm-tasks/types";

/**
 * The worker's old task page. Their tasks from the owner now sit in the Tasks
 * section next to the sales tasks; the address keeps working.
 */
export default async function MyTasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const item of Array.isArray(value) ? value : value ? [value] : [])
      params.append(key, item);
  }
  const query = params.toString();
  redirect(query ? `${TASKS_PATH}?${query}` : TASKS_PATH);
}
