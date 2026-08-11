import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { readProfileAccess } from "@/lib/auth/profile-access";
import { getCatalog } from "@/lib/catalog";

import { UploadStudio } from "./upload-studio";

export const metadata: Metadata = {
  title: "Upload | WrapForge",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function UploadPage({
  searchParams,
}: {
  searchParams?: Promise<{ replace?: string | string[] }>;
}) {
  const access = await readProfileAccess();
  if (access.status === "guest") redirect("/sign-in?next=%2Fupload");
  if (access.status === "incomplete") redirect("/onboarding?next=%2Fupload");
  if (access.status === "unavailable") {
    redirect("/sign-in?error=profile_unavailable&next=%2Fupload");
  }

  const requested = (await searchParams)?.replace;
  const replacementSlug = Array.isArray(requested) ? requested[0] : requested;
  return (
    <UploadStudio
      catalog={await getCatalog()}
      replacementSlug={
        replacementSlug && /^[a-z0-9][a-z0-9-]{2,79}$/.test(replacementSlug)
          ? replacementSlug
          : undefined
      }
      username={access.username}
    />
  );
}
