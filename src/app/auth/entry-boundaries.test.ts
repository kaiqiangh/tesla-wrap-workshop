import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readProfileAccess: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@/lib/auth/profile-access", () => ({
  readProfileAccess: mocks.readProfileAccess,
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import CompleteSignIn from "./complete/page";
import OnboardingPage from "../onboarding/page";
import UploadPage from "../upload/page";

describe("auth-gated page failure recovery", () => {
  beforeEach(() => {
    mocks.readProfileAccess.mockReset();
    mocks.redirect.mockReset().mockImplementation((destination: string) => {
      throw new Error(`redirect:${destination}`);
    });
  });

  async function expectProfileAccessRecovery(render: () => Promise<unknown>) {
    mocks.readProfileAccess.mockRejectedValue(
      new Error("database unavailable"),
    );

    await expect(render()).rejects.toThrow(
      "redirect:/sign-in?error=profile_unavailable&next=%2Fupload",
    );
  }

  it("returns sign-in recovery from auth completion when Profile access fails", async () => {
    await expectProfileAccessRecovery(() =>
      CompleteSignIn({ searchParams: Promise.resolve({ next: "/upload" }) }),
    );
  });

  it("returns sign-in recovery from onboarding when Profile access fails", async () => {
    await expectProfileAccessRecovery(() =>
      OnboardingPage({ searchParams: Promise.resolve({ next: "/upload" }) }),
    );
  });

  it("returns sign-in recovery from Upload when Profile access fails", async () => {
    await expectProfileAccessRecovery(() => UploadPage({}));
  });
});
