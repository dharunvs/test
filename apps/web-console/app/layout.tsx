import "./globals.css";

import { ClerkProvider, SignedIn, SignedOut, SignInButton, UserButton } from "@clerk/nextjs";
import Link from "next/link";
import type { ReactNode } from "react";

import { setActiveScopeAction } from "./server-actions";
import { resolveActiveScope } from "../lib/api";
import { isClerkConfigured } from "../lib/clerk";

export const metadata = {
  title: "Branchline Console",
  description: "Control plane for AI-native team development"
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const clerkEnabled = isClerkConfigured();
  const scope = await resolveActiveScope().catch(() => ({
    organizations: [],
    projects: [],
    orgId: undefined,
    projectId: undefined
  }));
  const scopeSelectorEnabled = scope.organizations.length > 0;
  const scopeForm = (
    <form action={setActiveScopeAction} className="scope-form">
      <input type="hidden" name="returnPath" value="/" />
      <label className="field">
        Organization
        <select name="orgId" defaultValue={scope.orgId}>
          {scope.organizations.map((org) => (
            <option key={org.id} value={org.id}>
              {org.name} ({org.role})
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Project
        <select name="projectId" defaultValue={scope.projectId}>
          <option value="">No project</option>
          {scope.projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </label>
      <button type="submit">Set scope</button>
    </form>
  );

  const content = (
    <main className="shell">
      <header className="card topbar">
        <div className="topbar-row">
          <div className="brand">
            <span className="brand-mark">Branchline</span>
            <span className="brand-meta">Control Console</span>
          </div>
          {clerkEnabled ? (
            <div className="auth-zone">
              <SignedIn>
                <UserButton />
              </SignedIn>
              <SignedOut>
                <SignInButton mode="modal">
                  <button type="button">Sign in</button>
                </SignInButton>
              </SignedOut>
            </div>
          ) : (
            <span className="brand-meta">Auth setup required</span>
          )}
        </div>
        <nav className="topnav">
          <Link href="/">Overview</Link>
          <Link href={"/onboarding" as never}>Onboarding</Link>
          <Link href="/projects">Projects</Link>
          <Link href={"/team" as never}>Team</Link>
          <Link href={"/repositories" as never}>Repositories</Link>
          <Link href={"/tasks" as never}>Tasks</Link>
          <Link href="/activity">Activity</Link>
          <Link href={"/pivot" as never}>Pivot</Link>
          <Link href={"/quality" as never}>Quality</Link>
          {scope.projectId ? (
            <Link href={`/projects/${scope.projectId}/knowledge` as never}>Project Hub</Link>
          ) : null}
          <Link href={"/prompts" as never}>Prompts</Link>
          <Link href="/integrations">Integrations</Link>
          <Link href={"/integrations/health" as never}>Integration Health</Link>
          <Link href="/provenance">Provenance</Link>
          <Link href="/replay">Replay</Link>
          <Link href={"/audit" as never}>Audit</Link>
        </nav>
        {scopeSelectorEnabled ? (
          clerkEnabled ? (
            <SignedIn>
              {scopeForm}
            </SignedIn>
          ) : (
            scopeForm
          )
        ) : null}
      </header>
      {children}
    </main>
  );

  return (
    <html lang="en">
      <body>
        {clerkEnabled && publishableKey ? (
          <ClerkProvider publishableKey={publishableKey}>{content}</ClerkProvider>
        ) : (
          content
        )}
      </body>
    </html>
  );
}
