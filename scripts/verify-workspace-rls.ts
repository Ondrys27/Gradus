/**
 * Checks the shared workspace against the real database, through RLS, with two
 * throw-away accounts: an owner and their worker.
 *
 *   bun scripts/verify-workspace-rls.ts
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL, the publishable (anon) key and the secret
 * (service role) key in the environment; Bun reads .env and .env.local by
 * itself. The secret key only creates the two accounts, links the worker and
 * removes both accounts (with everything they own) at the end. Every check
 * runs with a signed-in account and the public key, exactly like the app.
 *
 * Verified:
 *   1. a worker with the contacts right sees the owner's contacts
 *   2. without the right they see none
 *   3. without the edit right they cannot write (insert, update, delete, move)
 *   4. they never see the owner's finance or settings, even with every other right
 *   5. a right taken away stops working on the very next query
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../src/types/database";

type Db = SupabaseClient<Database>;
type Section = "milestones" | "contacts" | "pipeline" | "cold_calling" | "calendar" | "finance";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publicKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !publicKey || !secretKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL, the publishable key or the secret key.");
  process.exit(2);
}

const noSession = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };
const admin: Db = createClient<Database>(url, secretKey, { auth: noSession });

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    console.log(`  ok    ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${name}`, detail ?? "");
  }
}

async function account(label: string) {
  const email = `rls-${label}-${crypto.randomUUID()}@example.com`;
  const password = `${crypto.randomUUID()}Aa1!`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { locale: "en" },
  });
  if (error || !data.user) throw error ?? new Error("createUser returned no user");
  const client: Db = createClient<Database>(url!, publicKey!, { auth: noSession });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { id: data.user.id, client };
}

async function main() {
  console.log("Creating two test accounts…");
  const owner = await account("owner");
  const worker = await account("worker");

  try {
    // The server links the worker to the owner, as an accepted invite does.
    const { data: workerRow, error: linkError } = await admin
      .from("workers")
      .insert({ owner_id: owner.id, user_id: worker.id, name: "RLS check", status: "active" })
      .select("id")
      .single();
    if (linkError) throw linkError;
    const workerId = workerRow.id;

    // The owner's data, written by the owner through RLS.
    const { data: contact, error: contactError } = await owner.client
      .from("contacts")
      .insert({ user_id: owner.id, company_name: "RLS Owner Ltd" })
      .select("id")
      .single();
    if (contactError) throw contactError;
    const { error: moneyError } = await owner.client.from("transactions").insert({
      user_id: owner.id,
      type: "income",
      amount: 1000,
      occurred_on: new Date().toISOString().slice(0, 10),
      description: "RLS secret income",
    });
    if (moneyError) throw moneyError;
    const { data: noAnswer } = await owner.client
      .from("contact_tables")
      .select("id")
      .eq("user_id", owner.id)
      .eq("system_key", "no_answer")
      .single();

    /** The owner sets the worker's rights, as the matrix in the worker detail does. */
    async function grant(access: Partial<Record<Section, "view" | "edit">>) {
      const sections: Section[] = [
        "milestones",
        "contacts",
        "pipeline",
        "cold_calling",
        "calendar",
        "finance",
      ];
      const { error } = await owner.client.from("worker_permissions").upsert(
        sections.map((section) => ({
          owner_id: owner.id,
          worker_id: workerId,
          section,
          can_view: access[section] !== undefined,
          can_edit: access[section] === "edit",
        })),
        { onConflict: "worker_id,section" },
      );
      if (error) throw error;
    }

    const workspace = await worker.client.rpc("current_workspace_id");
    check("the worker's workspace is the owner's account", workspace.data === owner.id, workspace);

    console.log("1. With the contacts right (view):");
    await grant({ contacts: "view" });
    const seen = await worker.client.from("contacts").select("id").eq("user_id", owner.id);
    check(
      "sees the owner's contact",
      seen.data?.some((row) => row.id === contact.id) === true,
      seen,
    );

    console.log("2. Without any right:");
    await grant({});
    const hidden = await worker.client.from("contacts").select("id").eq("user_id", owner.id);
    check("sees no contact of the owner", (hidden.data ?? []).length === 0, hidden);

    console.log("3. With view but not edit:");
    await grant({ contacts: "view", cold_calling: "view" });
    const insert = await worker.client
      .from("contacts")
      .insert({ user_id: owner.id, company_name: "Sneaky" });
    check("cannot add a contact", insert.error !== null, insert);
    const update = await worker.client
      .from("contacts")
      .update({ company_name: "Renamed" })
      .eq("id", contact.id)
      .select("id");
    check("cannot rename a contact", (update.data ?? []).length === 0, update);
    const remove = await worker.client.from("contacts").delete().eq("id", contact.id).select("id");
    check("cannot delete a contact", (remove.data ?? []).length === 0, remove);
    const move = await worker.client.rpc("move_contact", {
      _contact_id: contact.id,
      _to_table_id: noAnswer?.id ?? contact.id,
    });
    check("cannot move a contact", move.error !== null, move);
    const still = await admin.from("contacts").select("company_name").eq("id", contact.id).single();
    check("the contact is unchanged", still.data?.company_name === "RLS Owner Ltd", still);

    console.log("4. With every right except finance:");
    await grant({
      milestones: "edit",
      contacts: "edit",
      pipeline: "edit",
      cold_calling: "edit",
      calendar: "edit",
    });
    const money = await worker.client.from("transactions").select("id").eq("user_id", owner.id);
    check("sees none of the owner's transactions", (money.data ?? []).length === 0, money);
    const totals = await worker.client.rpc("finance_totals", {
      _from: "2000-01-01",
      _to: "2100-01-01",
    });
    check(
      "finance totals show nothing",
      (totals.data ?? []).every((row) => Number(row.income) === 0),
      totals,
    );
    const settings = await worker.client.from("user_settings").select("id").eq("user_id", owner.id);
    check("sees none of the owner's settings", (settings.data ?? []).length === 0, settings);
    const others = await worker.client.from("worker_invites").select("id");
    check("sees nothing of the workers section", (others.data ?? []).length === 0, others);
    const write = await worker.client
      .from("contacts")
      .insert({ user_id: owner.id, company_name: "Worker lead" })
      .select("id")
      .single();
    check("with edit, adds a contact to the owner's space", write.error === null, write);

    console.log("5. Taking a right away:");
    await grant({});
    const after = await worker.client.from("contacts").select("id").eq("user_id", owner.id);
    check("the next query already sees nothing", (after.data ?? []).length === 0, after);
  } finally {
    console.log("Removing the test accounts…");
    // Deleting an account cascades to everything it owns; only these two are touched.
    await admin.auth.admin.deleteUser(worker.id);
    await admin.auth.admin.deleteUser(owner.id);
  }

  if (failures > 0) {
    console.log(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
