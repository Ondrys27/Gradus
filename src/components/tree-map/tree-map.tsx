"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

export type { TreeMapNodeState } from "./tree-map-canvas";

/**
 * The tree map (and react-zoom-pan-pinch with it) loads only on the screens
 * that show one, with a skeleton of the same size meanwhile.
 */
export const TreeMap = dynamic(() => import("./tree-map-canvas").then((module) => module.TreeMap), {
  ssr: false,
  loading: () => <Skeleton className="h-[min(68dvh,640px)] min-h-96 rounded-2xl" />,
});
