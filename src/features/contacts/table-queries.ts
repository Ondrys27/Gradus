"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/features/account/queries";
import { useWorkspaceId } from "@/features/account/workspace-queries";
import { createClient } from "@/lib/supabase/client";
import { byPosition, nextPosition, reorder, type PositionChange } from "./field-logic";
import { contactKeys } from "./queries";
import type { FieldInput, TableInput } from "./schemas";
import {
  FIELD_COLUMNS,
  MEETING_FIELD_KEY,
  TABLE_COLUMNS,
  type ContactField,
  type ContactTable,
} from "./types";

/** Questions of all tables together; a user has tens, this only bounds the query. */
const FIELD_LIMIT = 500;

export const fieldKeys = {
  all: (userId: string) => ["contacts", userId, "fields"] as const,
};

export function useFields() {
  const { user } = useSession();
  const workspaceId = useWorkspaceId();
  return useQuery({
    queryKey: fieldKeys.all(user.id),
    queryFn: async (): Promise<ContactField[]> => {
      const { data, error } = await createClient()
        .from("contact_table_fields")
        .select(FIELD_COLUMNS)
        .eq("user_id", workspaceId)
        .order("position")
        .limit(FIELD_LIMIT);
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateTable() {
  const { user } = useSession();
  const workspaceId = useWorkspaceId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: TableInput): Promise<ContactTable> => {
      const tables = queryClient.getQueryData<ContactTable[]>(contactKeys.tables(user.id)) ?? [];
      const { data, error } = await createClient()
        .from("contact_tables")
        .insert({ ...input, user_id: workspaceId, position: nextPosition(tables) })
        .select(TABLE_COLUMNS)
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (row) => {
      queryClient.setQueryData<ContactTable[]>(contactKeys.tables(user.id), (tables) =>
        tables ? byPosition([...tables, row]) : tables,
      );
    },
  });
}

export function useUpdateTable() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<TableInput> }) => {
      const { data, error } = await createClient()
        .from("contact_tables")
        .update(patch)
        .eq("id", id)
        .select(TABLE_COLUMNS)
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (row) => {
      queryClient.setQueryData<ContactTable[]>(contactKeys.tables(user.id), (tables) =>
        tables?.map((table) => (table.id === row.id ? row : table)),
      );
    },
  });
}

type ReorderVariables = { activeId: string; overId: string; changes: PositionChange[] };

async function savePositions(
  table: "contact_tables" | "contact_table_fields",
  changes: PositionChange[],
) {
  const results = await Promise.all(
    changes.map(({ id, position }) => createClient().from(table).update({ position }).eq("id", id)),
  );
  const failed = results.find((result) => result.error);
  if (failed?.error) throw failed.error;
}

/** The new order shows at once; only the positions that changed are saved. */
export function useReorderTables() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const key = contactKeys.tables(user.id);
  return useMutation({
    mutationFn: ({ changes }: ReorderVariables) => savePositions("contact_tables", changes),
    onMutate: async ({ activeId, overId }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<ContactTable[]>(key);
      if (previous) queryClient.setQueryData(key, reorder(previous, activeId, overId).items);
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}

/** Contacts of the table move to `moveTo` inside the database function, then the table goes. */
export function useRemoveTable() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, moveTo }: { id: string; moveTo: string | null }) => {
      const { error } = await createClient().rpc("remove_contact_table", {
        _table_id: id,
        _move_to: moveTo ?? undefined,
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: contactKeys.all(user.id) }),
  });
}

/** Keeps other system keys of a seeded question; only the meeting key follows the switch. */
function systemKeyFor(input: FieldInput, previous: string | null): string | null {
  if (input.type === "datetime" && input.meeting) return MEETING_FIELD_KEY;
  return previous === MEETING_FIELD_KEY ? null : previous;
}

export function useSaveField() {
  const { user } = useSession();
  const workspaceId = useWorkspaceId();
  const queryClient = useQueryClient();
  const key = fieldKeys.all(user.id);
  return useMutation({
    mutationFn: async ({
      tableId,
      field,
      input,
    }: {
      tableId: string;
      /** The question being edited; a new one when absent. */
      field?: ContactField;
      input: FieldInput;
    }) => {
      const row = {
        label: input.label,
        type: input.type,
        required: input.required,
        options: input.type === "select" ? input.options : null,
        depends_on_field_id: input.depends_on_field_id,
        depends_on_value: input.depends_on_field_id ? input.depends_on_value : null,
        system_key: systemKeyFor(input, field?.system_key ?? null),
      };
      const supabase = createClient();
      if (field) {
        const { error } = await supabase
          .from("contact_table_fields")
          .update(row)
          .eq("id", field.id);
        if (error) throw error;
        return;
      }
      const siblings = (queryClient.getQueryData<ContactField[]>(key) ?? []).filter(
        (item) => item.table_id === tableId,
      );
      const { error } = await supabase.from("contact_table_fields").insert({
        ...row,
        user_id: workspaceId,
        table_id: tableId,
        position: nextPosition(siblings),
      });
      if (error) throw error;
    },
    // Changing a select's options may remove the questions that hung on them.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}

export function useDeleteField() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await createClient().from("contact_table_fields").delete().eq("id", id);
      if (error) throw error;
    },
    // Questions depending on it go too.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: fieldKeys.all(user.id) }),
  });
}

export function useReorderFields() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const key = fieldKeys.all(user.id);
  return useMutation({
    mutationFn: ({ changes }: ReorderVariables & { tableId: string }) =>
      savePositions("contact_table_fields", changes),
    onMutate: async ({ activeId, overId, tableId }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<ContactField[]>(key);
      if (previous) {
        const moved = reorder(
          previous.filter((field) => field.table_id === tableId),
          activeId,
          overId,
        ).items;
        const byId = new Map(moved.map((field) => [field.id, field]));
        queryClient.setQueryData(
          key,
          byPosition(previous.map((field) => byId.get(field.id) ?? field)),
        );
      }
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}
