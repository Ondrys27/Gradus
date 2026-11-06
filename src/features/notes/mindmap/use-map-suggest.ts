"use client";

import { useMutation } from "@tanstack/react-query";
import { useSession } from "@/features/account/queries";
import { JarvisJobError, postJarvisJob } from "@/features/jarvis/queries";
import { getNoteSaver } from "../queries";
import type { SuggestedBranch } from "./map-ops";

/**
 * Jarvis suggests branches under one node of a map note ("fill in my
 * competitors map"). The map's latest edits are saved first, because the
 * server reads the note itself; what comes back is only a proposal, which
 * the map shows grey until the user accepts or deletes it.
 */
export function useSuggestBranches() {
  const { user } = useSession();
  return useMutation({
    mutationKey: ["jarvis", "note-map-suggest"],
    mutationFn: async (input: {
      noteId: string;
      nodeId: string;
      request: string;
    }): Promise<SuggestedBranch[]> => {
      const saver = getNoteSaver(user.id);
      await saver.flush(input.noteId);
      if (saver.unsavedDraft(input.noteId)) throw new JarvisJobError("network");
      const result = await postJarvisJob<{ branches: SuggestedBranch[] }>({
        kind: "noteMapSuggest",
        noteId: input.noteId,
        nodeId: input.nodeId,
        request: input.request.trim() || undefined,
      });
      if (!result.ok) throw new JarvisJobError(result.code);
      return result.branches;
    },
  });
}
