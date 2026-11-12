"use client";

import { useState, type FormEvent } from "react";
import { Loader2Icon, SparklesIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { fieldA11y, FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/input";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { NOTE_MAP_REQUEST_MAX } from "@/features/grady/protocol";
import { GradyJobError } from "@/features/grady/queries";
import type { SuggestedBranch } from "./map-ops";
import { useSuggestBranches } from "./use-map-suggest";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  noteId: string;
  node: { id: string; title: string } | null;
  onSuggested: (nodeId: string, branches: SuggestedBranch[]) => void;
};

/** "Suggest branches": what Grady should add under the selected node, then his proposal. */
export function SuggestDialog({ open, onOpenChange, noteId, node, onSuggested }: Props) {
  const t = useTranslations("notes.map.suggest");
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("title")}
      closeLabel={t("close")}
      className="w-[min(100vw-32px,480px)]"
    >
      {node && (
        <SuggestForm
          key={node.id}
          noteId={noteId}
          node={node}
          onCancel={() => onOpenChange(false)}
          onSuggested={(branches) => {
            onSuggested(node.id, branches);
            onOpenChange(false);
          }}
        />
      )}
    </ResponsiveDialog>
  );
}

function SuggestForm({
  noteId,
  node,
  onCancel,
  onSuggested,
}: {
  noteId: string;
  node: { id: string; title: string };
  onCancel: () => void;
  onSuggested: (branches: SuggestedBranch[]) => void;
}) {
  const t = useTranslations("notes.map.suggest");
  const tError = useTranslations("grady.error");
  const [request, setRequest] = useState("");
  const suggest = useSuggestBranches();

  function submit(event: FormEvent) {
    event.preventDefault();
    suggest.mutate({ noteId, nodeId: node.id, request }, { onSuccess: onSuggested });
  }

  const code = suggest.error instanceof GradyJobError ? suggest.error.code : suggest.error ? "unknown" : null;
  const error =
    code === null
      ? null
      : code === "limitReached" || code === "empty" || code === "notFound"
        ? t(`errors.${code}`)
        : code === "paused" ||
            code === "userLimit" ||
            code === "spaceLimit" ||
            code === "notConfigured" ||
            code === "network" ||
            code === "busy"
          ? tError(code)
          : tError("unavailable");

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" data-testid="note-map-suggest">
      <p className="text-sm text-ink-soft">
        {t("intro", { title: node.title || t("untitledNode") })}
      </p>
      <FormField id="map-suggest-request" label={t("requestLabel")} hint={t("requestHint")}>
        <Textarea
          value={request}
          rows={2}
          maxLength={NOTE_MAP_REQUEST_MAX}
          placeholder={t("requestPlaceholder")}
          onChange={(event) => setRequest(event.target.value)}
          autoFocus
          {...fieldA11y("map-suggest-request", undefined, true)}
        />
      </FormField>
      {error && <FormAlert>{error}</FormAlert>}
      <p className="text-xs text-ink-muted">{t("note")}</p>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={suggest.isPending}>
          {suggest.isPending ? (
            <Loader2Icon aria-hidden data-icon="inline-start" className="animate-spin motion-reduce:animate-none" />
          ) : (
            <SparklesIcon aria-hidden data-icon="inline-start" />
          )}
          {suggest.isPending ? t("thinking") : t("submit")}
        </Button>
      </div>
    </form>
  );
}
