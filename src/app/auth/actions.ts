"use server";

import { redirect } from "next/navigation";

import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function signOut() {
  const supabase = await createServerSupabaseClient();
  await supabase.auth.getClaims();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/");
}
