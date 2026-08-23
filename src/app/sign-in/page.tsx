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
  readPublicEnvironment(process.env);
  const message =
    query.error && Object.hasOwn(messages, query.error)
      ? messages[query.error]
      : undefined;

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
        {message ? (
          <p className="form-error" role="alert">
            {message}
          </p>
        ) : null}
        <SignInForm next={next} />
      </section>
    </main>
  );
}
