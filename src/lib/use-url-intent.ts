"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * A one-off request carried in the address, e.g. `/contacts?new=contact` from
 * the search: `handle` runs once for it, then the parameter (and `extra`
 * companions) is removed so Back or a refresh does not repeat it. Return
 * `false` while the page is not ready yet; it is tried again on the next render.
 */
export function useUrlIntent(
  name: string,
  handle: (value: string, params: URLSearchParams) => boolean | void,
  extra: readonly string[] = [],
) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const value = params.get(name);
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (value === null) {
      handled.current = null;
      return;
    }
    const key = params.toString();
    if (handled.current === key) return;
    if (handle(value, new URLSearchParams(params)) === false) return;
    handled.current = key;
    const next = new URLSearchParams(params);
    next.delete(name);
    for (const companion of extra) next.delete(companion);
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  });
}
