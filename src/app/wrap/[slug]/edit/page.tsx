import { notFound, redirect } from "next/navigation";

import { readProfileAccess } from "@/lib/auth/profile-access";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { WrapEditor, type EditableWrap } from "../../wrap-editor";

type Props = { params: Promise<{ slug: string }> };

export default async function WrapEditPage({ params }: Props) {
  const { slug } = await params;
  const supabase = await createServerSupabaseClient();
  const access = await readProfileAccess(supabase);
  if (access.status === "guest") {
    redirect(`/sign-in?next=${encodeURIComponent(`/wrap/${slug}/edit`)}`);
  }
  if (access.status !== "active") redirect("/upload");
  const { data, error } = await supabase.rpc("get_owner_wrap", {
    p_creator_id: access.userId,
    p_slug: slug,
  });
  if (error) throw new Error("Wrap management is temporarily unavailable");
  const wrap = data?.[0];
  if (!wrap) notFound();
  return <WrapEditor username={access.username} wrap={wrap as EditableWrap} />;
}
