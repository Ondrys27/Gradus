import { redirect } from "next/navigation";
import { COMPANY_PATH } from "@/lib/routes";

/** A person's page is now their dashboard in Company: the old address opens it there. */
export default async function WorkerPage({ params }: { params: Promise<{ workerId: string }> }) {
  const { workerId } = await params;
  redirect(`${COMPANY_PATH}?worker=${encodeURIComponent(workerId)}`);
}
