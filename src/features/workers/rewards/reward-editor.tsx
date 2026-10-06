"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeftIcon, GiftIcon, SparklesIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { TreeMap } from "@/components/tree-map/tree-map";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormAlert } from "@/components/ui/form-alert";
import { GlowCard } from "@/components/ui/glow-card";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Stagger, StaggerItem } from "@/components/ui/stagger";
import { JarvisJobError } from "@/features/jarvis/queries";
import { cn } from "@/lib/utils";
import { useWorkers } from "../queries";
import { BranchDialog, LeafDialog } from "./reward-dialogs";
import { RewardBranchNode, RewardLeafNode, RewardRootNode } from "./reward-nodes";
import {
  useActiveRewardRules,
  useConfirmRewardRules,
  useRewardDraft,
  useRewardSetup,
  useSaveRewardDraft,
} from "./reward-queries";
import {
  addBranch,
  addLeaf,
  compileRewardTree,
  findLeaf,
  leafCount,
  MAX_BRANCHES,
  MAX_LEAVES,
  notesWithoutAi,
  removeBranch,
  removeLeaf,
  ROOT_ID,
  toMapBranch,
  updateBranch,
  updateLeaf,
  type RewardProposal,
  type RewardTree,
} from "./reward-tree";
import { ProposalDialog } from "./proposal-dialog";
import { RuleText } from "./rule-text";

/** Codes with their own text under `workers.rewards.aiError`. */
const AI_ERRORS = ["notConfigured", "busy", "unavailable", "limitReached", "network", "empty"];

const noop = () => {};

/**
 * The reward system as a tree: root, triggers, rules. Every edit is saved as a
 * draft; "Let AI set it up" has Jarvis turn the tree into rules and explain
 * them, and nothing runs until the owner confirms.
 */
export function RewardEditor() {
  const t = useTranslations("workers.rewards");
  const draft = useRewardDraft();
  const save = useSaveRewardDraft();
  const workers = useWorkers();
  const active = useActiveRewardRules();
  const setup = useRewardSetup();
  const confirm = useConfirmRewardRules();

  const [branchDialog, setBranchDialog] = useState<{ open: boolean; id: string | null }>({
    open: false,
    id: null,
  });
  const [leafDialog, setLeafDialog] = useState<{
    open: boolean;
    branchId: string;
    leafId: string | null;
  }>({ open: false, branchId: "", leafId: null });
  const [proposal, setProposal] = useState<RewardProposal | null>(null);
  const [droppedNotes, setDroppedNotes] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);

  const tree = draft.data;
  const workerList = useMemo(
    () => (workers.data ?? []).map((worker) => ({ id: worker.id, name: worker.name })),
    [workers.data],
  );
  const workerNames = useMemo(
    () => new Map(workerList.map((worker) => [worker.id, worker.name])),
    [workerList],
  );
  const mapTree = useMemo(() => (tree ? toMapBranch(tree) : null), [tree]);

  function commit(next: RewardTree) {
    setConfirmed(false);
    save.mutate(next);
  }

  function askJarvis() {
    if (!tree) return;
    setConfirmed(false);
    setup.mutate(tree, {
      onSuccess: (result) => {
        setDroppedNotes([]);
        setProposal(result);
      },
    });
  }

  function withoutJarvis() {
    if (!tree) return;
    setDroppedNotes(notesWithoutAi(tree));
    setProposal(compileRewardTree(tree, null));
  }

  function confirmProposal() {
    if (!proposal) return;
    confirm.mutate(proposal.rules, {
      onSuccess: () => {
        setProposal(null);
        setConfirmed(true);
        setup.reset();
      },
    });
  }

  const aiCode = setup.error instanceof JarvisJobError ? setup.error.code : setup.error ? "unknown" : null;
  const openBranch = tree?.branches.find((branch) => branch.id === branchDialog.id) ?? null;
  const leafBranch = tree?.branches.find((branch) => branch.id === leafDialog.branchId) ?? null;
  const openLeaf = tree && leafDialog.leafId ? (findLeaf(tree, leafDialog.leafId)?.leaf ?? null) : null;
  const rules = tree ? leafCount(tree) : 0;

  return (
    <Stagger className="flex flex-col gap-6">
      <StaggerItem>
        <Link
          href="/app/pracovnici"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "self-start")}
        >
          <ArrowLeftIcon aria-hidden data-icon="inline-start" />
          {t("back")}
        </Link>
      </StaggerItem>
      <StaggerItem>
        <PageHeader
          title={t("title")}
          description={t("description")}
          actions={
            <Button onClick={askJarvis} disabled={!tree || rules === 0 || setup.isPending}>
              <SparklesIcon aria-hidden data-icon="inline-start" />
              {setup.isPending ? t("aiWorking") : t("askAi")}
            </Button>
          }
        />
      </StaggerItem>

      {(aiCode || save.isError || confirmed) && (
        <StaggerItem className="flex flex-col gap-3">
          {aiCode && (
            <div className="flex flex-col gap-3 rounded-2xl border border-pink/30 bg-pink/10 p-4 sm:flex-row sm:items-center sm:justify-between">
              <p role="alert" className="text-sm text-pink">
                {t(`aiError.${AI_ERRORS.includes(aiCode) ? aiCode : "unknown"}`)}
              </p>
              {aiCode !== "empty" && (
                <Button variant="outline" onClick={withoutJarvis} className="shrink-0">
                  {t("withoutAi")}
                </Button>
              )}
            </div>
          )}
          {save.isError && <FormAlert>{t("saveFailed")}</FormAlert>}
          {confirmed && <FormAlert tone="success">{t("confirmed")}</FormAlert>}
        </StaggerItem>
      )}

      <StaggerItem>
        {draft.isError ? (
          <FormAlert>{t("loadFailed")}</FormAlert>
        ) : !tree || !mapTree ? (
          <Skeleton className="h-96 w-full rounded-2xl" />
        ) : (
          <TreeMap
            tree={mapTree}
            label={t("mapLabel")}
            contentKey={JSON.stringify(tree)}
            renderNode={(id, node) => {
              if (id === ROOT_ID) {
                return (
                  <RewardRootNode
                    ruleCount={rules}
                    onAdd={
                      node.measuring || tree.branches.length >= MAX_BRANCHES
                        ? noop
                        : () => setBranchDialog({ open: true, id: null })
                    }
                  />
                );
              }
              const branch = tree.branches.find((item) => item.id === id);
              if (branch) {
                return (
                  <RewardBranchNode
                    branch={branch}
                    scope={
                      branch.workerId
                        ? (workerNames.get(branch.workerId) ?? t("scope.removed"))
                        : t("scope.all")
                    }
                    collapsed={node.collapsed}
                    onOpen={node.measuring ? noop : () => setBranchDialog({ open: true, id })}
                    onAdd={
                      node.measuring || branch.leaves.length >= MAX_LEAVES
                        ? noop
                        : () => setLeafDialog({ open: true, branchId: id, leafId: null })
                    }
                    onToggleCollapsed={node.onToggleCollapsed}
                  />
                );
              }
              const found = findLeaf(tree, id);
              if (!found) return null;
              return (
                <RewardLeafNode
                  leaf={found.leaf}
                  onOpen={
                    node.measuring
                      ? noop
                      : () => setLeafDialog({ open: true, branchId: found.branch.id, leafId: id })
                  }
                />
              );
            }}
          />
        )}
        {tree && tree.branches.length === 0 && (
          <p className="mt-3 text-sm text-ink-muted">{t("startHint")}</p>
        )}
      </StaggerItem>

      <StaggerItem>
        <GlowCard interactive={false} className="flex flex-col gap-4">
          <h2 className="micro-label">{t("activeTitle")}</h2>
          {active.isError ? (
            <FormAlert>{t("loadFailed")}</FormAlert>
          ) : !active.data ? (
            <Skeleton className="h-20 w-full" />
          ) : active.data.length === 0 ? (
            <EmptyState
              icon={<GiftIcon />}
              title={t("noActiveTitle")}
              description={t("noActiveDescription")}
              className="py-8"
            />
          ) : (
            <ul className="flex flex-col gap-3">
              {active.data.map((rule, index) => (
                <li key={index}>
                  <RuleText rule={rule} workerNames={workerNames} />
                </li>
              ))}
            </ul>
          )}
        </GlowCard>
      </StaggerItem>

      <BranchDialog
        open={branchDialog.open}
        onOpenChange={(open) => setBranchDialog((current) => ({ ...current, open }))}
        branch={openBranch}
        workers={workerList}
        onSave={(value) => {
          if (!tree) return;
          if (openBranch) commit(updateBranch(tree, openBranch.id, value));
          else commit(addBranch(tree, { id: crypto.randomUUID(), ...value, leaves: [] }));
        }}
        onDelete={() => tree && openBranch && commit(removeBranch(tree, openBranch.id))}
      />
      {leafBranch && (
        <LeafDialog
          open={leafDialog.open}
          onOpenChange={(open) => setLeafDialog((current) => ({ ...current, open }))}
          trigger={leafBranch.trigger}
          leaf={openLeaf}
          onSave={(value) => {
            if (!tree) return;
            if (openLeaf) commit(updateLeaf(tree, { ...openLeaf, ...value }));
            else commit(addLeaf(tree, leafBranch.id, { id: crypto.randomUUID(), ...value }));
          }}
          onDelete={() => tree && openLeaf && commit(removeLeaf(tree, openLeaf.id))}
        />
      )}
      <ProposalDialog
        proposal={proposal}
        droppedNotes={droppedNotes}
        workerNames={workerNames}
        pending={confirm.isPending}
        failed={confirm.isError}
        onConfirm={confirmProposal}
        onClose={() => {
          setProposal(null);
          confirm.reset();
        }}
      />
    </Stagger>
  );
}
