"use server";

import {
  changePasswordSchema,
  authErrorKey,
  fieldErrorsFrom,
  type FormState,
} from "@/features/auth/schemas";
import { createClient } from "@/lib/supabase/server";

/** Asks for the current password before setting a new one. */
export async function changePassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = changePasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const email = data?.claims?.email;
  if (typeof email !== "string" || !email) return { error: "generic" };

  const { error: verifyError } = await supabase.auth.signInWithPassword({
    email,
    password: parsed.data.current,
  });
  if (verifyError) {
    const key = authErrorKey(verifyError);
    return key === "rateLimited"
      ? { error: key }
      : { fieldErrors: { current: "wrongCurrentPassword" } };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    const key = authErrorKey(error);
    if (key === "samePassword" || key === "weakPassword") return { fieldErrors: { password: key } };
    return { error: key };
  }
  return { success: true };
}
