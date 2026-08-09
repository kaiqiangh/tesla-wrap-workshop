import type { Metadata } from "next";

import { safeNextPath } from "@/lib/auth/redirect";
import { readPublicEnvironment } from "@/lib/env";

import { Brand } from "../brand";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = {
  title: "Sign in | WrapForge",
  robots: { index: false, follow: false },
};

const messages: Record<string, string> = {
  oauth_failed: "That sign-in could not be completed. Please try again.",
  session_failed: "Your sign-in expired. Please start again.",
  profile_unavailable: "This Profile is currently unavailable.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const query = await searchParams;
  const next = safeNextPath(query.next);
  const env = readPublicEnvironment(process.env);

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="sign-in-title">
        <Brand />
        <p className="eyebrow">COMMUNITY IDENTITY</p>
        <h1 id="sign-in-title">Join the workshop</h1>
        <p className="auth-intro">
          Browse and download as a Guest. Sign in only when you want to create
          or join the community.
        </p>
        {query.error && messages[query.error] ? (
          <p className="form-error" role="alert">
            {messages[query.error]}
          </p>
        ) : null}
        <SignInForm
          next={next}
          siteUrl={env.NEXT_PUBLIC_SITE_URL}
          googleEnabled={env.WRAPFORGE_ENVIRONMENT !== "local"}
        />
      </section>
    </main>
  );
}
