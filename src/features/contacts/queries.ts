"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/features/account/queries";
import { createClient } from "@/lib/supabase/client";
import { duplicateEmailKey, duplicatePhoneKey, searchFilter } from "./contact-search";
import type { ActivityInput, ContactInput } from "./schemas";
import {
  ACTIVITY_COLUMNS,
  CONTACT_COLUMNS,
  CONTACT_DEAL_COLUMNS,
  LIST_COLUMNS,
  TABLE_COLUMNS,
  type Activity,
  type Contact,
  type ContactDeal,
  type ContactListItem,
  type ContactTable,
} from "./types";

export const PAGE_SIZE = 50;
/** A user has a handful of tables; this only bounds the query. */
const TABLE_LIMIT = 50;
const ACTIVITY_LIMIT = 200;
const DEAL_LIMIT = 50;
const DUPLICATE_LIMIT = 5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ListFilter = { term: string; tableId: string | null };

export const contactKeys = {
  all: (userId: string) => ["contacts", userId] as const,
  lists: (userId: string) => ["contacts", userId, "list"] as const,
  list: (userId: string, filter: ListFilter) => ["contacts", userId, "list", filter] as const,
  tables: (userId: string) => ["contacts", userId, "tables"] as const,
  detail: (userId: string, id: string) => ["contacts", userId, "detail", id] as const,
  entry: (userId: string, id: string) => ["contacts", userId, "entry", id] as const,
  activities: (userId: string, id: string) => ["contacts", userId, "activities", id] as const,
  deals: (userId: string, id: string) => ["contacts", userId, "deals", id] as const,
  duplicates: (userId: string, phone: string | null, email: string | null, exclude?: string) =>
    ["contacts", userId, "duplicates", phone, email, exclude ?? null] as const,
};

export function useContactTables() {
  const { user } = useSession();
  return useQuery({
    queryKey: contactKeys.tables(user.id),
    queryFn: async (): Promise<ContactTable[]> => {
      const { data, error } = await createClient()
        .from("contact_tables")
        .select(TABLE_COLUMNS)
        .order("position")
        .limit(TABLE_LIMIT);
      if (error) throw error;
      return data;
    },
  });
}

/** Most recently contacted first, never-contacted at the end; one page at a time. */
export function useContactList(filter: ListFilter) {
  const { user } = useSession();
  return useInfiniteQuery({
    queryKey: contactKeys.list(user.id, filter),
    initialPageParam: 0,
    queryFn: async ({ pageParam }): Promise<ContactListItem[]> => {
      let query = createClient().from("contact_list").select(LIST_COLUMNS);
      const search = searchFilter(filter.term);
      if (search) query = query.or(search);
      if (filter.tableId) query = query.eq("table_id", filter.tableId);
      const { data, error } = await query
        .order("last_contact_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .order("id")
        .range(pageParam, pageParam + PAGE_SIZE - 1);
      if (error) throw error;
      return data as ContactListItem[];
    },
    getNextPageParam: (last, pages) =>
      last.length === PAGE_SIZE ? pages.length * PAGE_SIZE : undefined,
  });
}

export function useContact(id: string) {
  const { user } = useSession();
  return useQuery({
    queryKey: contactKeys.detail(user.id, id),
    queryFn: async (): Promise<Contact | null> => {
      // A mistyped address is "not found", not a database error.
      if (!UUID.test(id)) return null;
      const { data, error } = await createClient()
        .from("contacts")
        .select(CONTACT_COLUMNS)
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

/** The table the contact is in right now, with the answers given on the way in. */
export function useContactEntry(id: string) {
  const { user } = useSession();
  return useQuery({
    queryKey: contactKeys.entry(user.id, id),
    queryFn: async () => {
      const { data, error } = await createClient()
        .from("contact_table_entries")
        .select("table_id, answers, moved_at")
        .eq("contact_id", id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useActivities(id: string) {
  const { user } = useSession();
  return useQuery({
    queryKey: contactKeys.activities(user.id, id),
    queryFn: async (): Promise<Activity[]> => {
      const { data, error } = await createClient()
        .from("contact_activities")
        .select(ACTIVITY_COLUMNS)
        .eq("contact_id", id)
        .order("occurred_at", { ascending: false })
        .limit(ACTIVITY_LIMIT);
      if (error) throw error;
      return data;
    },
  });
}

export function useContactDeals(id: string) {
  const { user } = useSession();
  return useQuery({
    queryKey: contactKeys.deals(user.id, id),
    queryFn: async (): Promise<ContactDeal[]> => {
      const { data, error } = await createClient()
        .from("deals")
        .select(CONTACT_DEAL_COLUMNS)
        .eq("contact_id", id)
        .order("created_at", { ascending: false })
        .limit(DEAL_LIMIT);
      if (error) throw error;
      return data;
    },
  });
}

export type Duplicate = Pick<
  Contact,
  "id" | "company_name" | "first_name" | "last_name" | "phone" | "email"
>;

/** Contacts with the same phone (prefix ignored) or e-mail. A warning, never a block. */
export function useDuplicates(phone: string, email: string, excludeId?: string) {
  const { user } = useSession();
  const phoneKey = duplicatePhoneKey(phone);
  const emailKey = duplicateEmailKey(email);
  return useQuery({
    queryKey: contactKeys.duplicates(user.id, phoneKey, emailKey, excludeId),
    enabled: phoneKey !== null || emailKey !== null,
    queryFn: async (): Promise<Duplicate[]> => {
      const filters = [
        phoneKey && `phone_normalized.like."%${phoneKey}"`,
        emailKey && `email.ilike."${emailKey}"`,
      ].filter(Boolean);
      let query = createClient()
        .from("contacts")
        .select("id, company_name, first_name, last_name, phone, email")
        .or(filters.join(","));
      if (excludeId) query = query.neq("id", excludeId);
      const { data, error } = await query.limit(DUPLICATE_LIMIT);
      if (error) throw error;
      return data;
    },
  });
}

/** The database fills phone_normalized and puts the contact into Unreached. */
export function useCreateContact() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ContactInput): Promise<Contact> => {
      const { data, error } = await createClient()
        .from("contacts")
        .insert({ ...input, user_id: user.id })
        .select(CONTACT_COLUMNS)
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (row) => {
      queryClient.setQueryData(contactKeys.detail(user.id, row.id), row);
      return queryClient.invalidateQueries({ queryKey: contactKeys.all(user.id) });
    },
  });
}

export function useUpdateContact(id: string) {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<ContactInput> & { notes?: string | null }) => {
      const { data, error } = await createClient()
        .from("contacts")
        .update(patch)
        .eq("id", id)
        .select(CONTACT_COLUMNS)
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (row) => {
      queryClient.setQueryData(contactKeys.detail(user.id, id), row);
      return queryClient.invalidateQueries({ queryKey: contactKeys.lists(user.id) });
    },
  });
}

export function useDeleteContact(id: string) {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await createClient().from("contacts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: contactKeys.detail(user.id, id) });
      void queryClient.invalidateQueries({ queryKey: contactKeys.lists(user.id) });
      // Deals keep their row but lose the contact.
      void queryClient.invalidateQueries({ queryKey: ["pipeline", user.id, "deals"] });
    },
  });
}

/** Every activity moves the contact's last contact; the list reads it again. */
export function useAddActivity(contactId: string) {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ActivityInput): Promise<Activity> => {
      const { data, error } = await createClient()
        .from("contact_activities")
        .insert({ ...input, contact_id: contactId, user_id: user.id })
        .select(ACTIVITY_COLUMNS)
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (row) => {
      queryClient.setQueryData<Activity[]>(contactKeys.activities(user.id, contactId), (list) =>
        list ? [row, ...list].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)) : list,
      );
      return queryClient.invalidateQueries({ queryKey: contactKeys.lists(user.id) });
    },
  });
}

export function useDeleteActivity(contactId: string) {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (activityId: string) => {
      const { error } = await createClient()
        .from("contact_activities")
        .delete()
        .eq("id", activityId);
      if (error) throw error;
      return activityId;
    },
    onSuccess: (activityId) => {
      queryClient.setQueryData<Activity[]>(contactKeys.activities(user.id, contactId), (list) =>
        list?.filter((item) => item.id !== activityId),
      );
      return queryClient.invalidateQueries({ queryKey: contactKeys.lists(user.id) });
    },
  });
}
