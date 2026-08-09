import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { readProfileAccess } from "@/lib/auth/profile-access";

import { signOut } from "../auth/actions";

export const metadata: Metadata = {
  title: "Upload | WrapForge",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function UploadPage() {
  const access = await readProfileAccess();
  if (access.status === "guest") redirect("/sign-in?next=%2Fupload");
  if (access.status === "incomplete") redirect("/onboarding?next=%2Fupload");
  if (access.status === "unavailable") {
    redirect("/sign-in?error=profile_unavailable&next=%2Fupload");
  }

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="upload-title">
        <p className="eyebrow">PROFILE READY</p>
        <h1 id="upload-title">Your upload workshop is ready.</h1>
        <p className="auth-intro">
          Signed in as @{access.username}. Asset finalization arrives in the
          next implementation slice.
        </p>
        <div className="hero-actions">
          <Link className="button" href={`/u/${access.username}`}>
            View Profile
          </Link>
          <Link className="text-link" href="/">
            Back home
          </Link>
        </div>
        <form action={signOut}>
          <button className="text-button" type="submit">
            Sign out
          </button>
        </form>
      </section>
    </main>
  );
}
