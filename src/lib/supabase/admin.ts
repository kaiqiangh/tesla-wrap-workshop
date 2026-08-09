import "server-only";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "../database.types";
import { readServerEnvironment } from "../env";

export function createAdminSupabaseClient() {
  const env = readServerEnvironment(process.env);
  return createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SECRET_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
