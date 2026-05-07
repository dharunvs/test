import { SignIn } from "@clerk/nextjs";

import { SectionHeader, SurfaceCard } from "../../../components/ui-primitives";
import {
  missingWebAuthConfigMessage,
  normalizeReturnTo,
  resolveWebAuthMode
} from "../../../lib/web-auth";

interface SignInPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function firstParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function resolveErrorMessage(error: string | undefined): string | undefined {
  if (!error) {
    return undefined;
  }

  if (error === "oauth_cancelled") {
    return "GitHub sign-in was cancelled.";
  }

  if (error === "oauth_state_mismatch") {
    return "GitHub sign-in could not be verified. Please try again.";
  }

  if (error === "oauth_exchange_failed") {
    return "Failed to exchange GitHub OAuth code. Please try again.";
  }

  if (error === "github_oauth_not_configured") {
    return "GitHub OAuth is not configured yet. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.";
  }

  return "Sign-in failed. Please try again.";
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const authMode = resolveWebAuthMode();
  const params = await searchParams;
  const returnTo = normalizeReturnTo(firstParam(params.returnTo));
  const error = resolveErrorMessage(firstParam(params.error));

  if (authMode === "none") {
    return (
      <section className="page-stack sign-panel">
        <SurfaceCard>
          <SectionHeader title="Sign In" subtitle={missingWebAuthConfigMessage} />
        </SurfaceCard>
      </section>
    );
  }

  if (authMode === "github") {
    return (
      <section className="page-stack sign-panel">
        <SurfaceCard>
          <SectionHeader title="Sign In" subtitle="Authenticate with your GitHub account to access the Branchline console." />
        </SurfaceCard>
        {error ? <p className="banner banner-error">{error}</p> : null}
        <SurfaceCard>
          <a href={`/api/auth/github/start?returnTo=${encodeURIComponent(returnTo)}`} className="link-button">
            Continue with GitHub
          </a>
        </SurfaceCard>
      </section>
    );
  }

  return (
    <section className="page-stack sign-panel">
      <SurfaceCard>
        <SectionHeader title="Sign In" subtitle="Authenticate to access console controls." />
      </SurfaceCard>
      <SurfaceCard>
        <SignIn forceRedirectUrl="/" />
      </SurfaceCard>
    </section>
  );
}
