"use client";

import type { ComponentProps } from "react";
import Link from "next/link";
import type { LinkProps as AppDirLinkProps } from "next/dist/client/app-dir/link";
import { usePathname } from "next/navigation";
import { markNavigating } from "./nav-pending";

/**
 * A menu link. Hovering it (or touching it on a phone) fetches the whole page
 * in advance, so by the time of the click it is usually already there; the
 * click itself marks the item active at once (nav-pending.ts).
 */
export function NavLink({ href, onNavigate, ...props }: ComponentProps<typeof Link> & { href: string }) {
  const pathname = usePathname();
  // next/link is the App Router's link at run time (Next aliases it), but its
  // published types are the Pages Router's, which lack this prop.
  const prefetchOnHover: Pick<AppDirLinkProps, "unstable_dynamicOnHover"> = { unstable_dynamicOnHover: true };
  return (
    <Link
      href={href}
      {...(prefetchOnHover as object)}
      onNavigate={(event) => {
        onNavigate?.(event);
        markNavigating(pathname, href);
      }}
      {...props}
    />
  );
}
