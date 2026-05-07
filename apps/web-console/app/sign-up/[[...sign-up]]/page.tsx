import { SignUp } from "@clerk/nextjs";

import { SectionHeader, SurfaceCard } from "../../../components/ui-primitives";
import {
  missingWebAuthConfigMessage,
  normalizeReturnTo,
  resolveWebAuthMode
} from "../../../lib/web-auth";

interface SignUpPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function firstParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export default async function SignUpPage({ searchParams }: SignUpPageProps) {
  const authMode = resolveWebAuthMode();
  const params = await searchParams;
  const returnTo = normalizeReturnTo(firstParam(params.returnTo));

  if (authMode === "none") {
    return (
      <section className="page-stack sign-panel">
        <SurfaceCard>
          <SectionHeader title="Sign Up" subtitle={missingWebAuthConfigMessage} />
        </SurfaceCard>
      </section>
    );
  }

  if (authMode === "github") {
    return (
      <section className="page-stack sign-panel">
        <SurfaceCard>
          <SectionHeader title="Sign Up" subtitle="Branchline uses GitHub OAuth for account creation and sign-in." />
        </SurfaceCard>
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
        <SectionHeader title="Sign Up" subtitle="Create an account to access console controls." />
      </SurfaceCard>
      <SurfaceCard>
        <SignUp forceRedirectUrl="/" />
      </SurfaceCard>
    </section>
  );
}
