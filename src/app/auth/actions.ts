"use server";

import { redirect } from "next/navigation";

import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function signOut() {
  const supabase = await createServerSupabaseClient();
  await supabase.auth.getClaims();
  // Global scope revokes the refresh token server-side (PR-05): a stolen
  // session must not survive sign-out, not merely leave this browser.
  await supabase.auth.signOut({ scope: "global" });
  redirect("/");
}
