import Link from "next/link";
import { UserRoundIcon } from "lucide-react";
import { ADMIN_PATH } from "../access";

/** The detail of one account in the administration. */
export function userDetailHref(userId: string): string {
  return `${ADMIN_PATH}/uzivatele/${userId}`;
}

/**
 * A small link from a report, an error record or a piece of feedback to the
 * detail of the account that sent it (support, step 22.1).
 */
export function UserDetailLink({ userId, label }: { userId: string; label: string }) {
  return (
    <Link
      href={userDetailHref(userId)}
      prefetch={false}
      data-testid="user-detail-link"
      className="inline-flex h-10 items-center gap-1 text-xs text-violet underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-violet/40 mouse:h-7"
    >
      <UserRoundIcon aria-hidden className="size-3.5" />
      {label}
    </Link>
  );
}
