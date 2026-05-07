import "./globals.css";

import { Montserrat } from "next/font/google";
import { cookies } from "next/headers";
import { ClerkProvider, SignedIn, SignedOut, SignInButton, UserButton } from "@clerk/nextjs";

const montserrat = Montserrat({
  subsets: ["latin"],
  variable: "--font-montserrat",
  display: "swap"
});
import type { ReactNode } from "react";

import { setActiveScopeAction } from "./server-actions";
import { SidebarNav } from "../components/sidebar-nav";
import { TopbarBreadcrumbs } from "../components/topbar-breadcrumbs";
import { resolveActiveScope } from "../lib/api";
import { isClerkConfigured } from "../lib/clerk";
import {
  WEB_AUTH_ACCESS_TOKEN_COOKIE,
  WEB_AUTH_USER_EMAIL_COOKIE,
  WEB_AUTH_USER_NAME_COOKIE,
  resolveWebAuthMode
} from "../lib/web-auth";

export const metadata = {
  title: "Branchline Console",
  description: "Control plane for AI-native team development"
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const authMode = resolveWebAuthMode();
  const clerkEnabled = authMode === "clerk" && isClerkConfigured();
  const cookieStore = await cookies();
  const githubAccessToken = cookieStore.get(WEB_AUTH_ACCESS_TOKEN_COOKIE)?.value;
  const githubSignedIn = authMode === "github" && typeof githubAccessToken === "string" && githubAccessToken.trim().length > 0;
  const githubUserDisplayName =
    cookieStore.get(WEB_AUTH_USER_NAME_COOKIE)?.value ??
    cookieStore.get(WEB_AUTH_USER_EMAIL_COOKIE)?.value ??
    "GitHub user";
  const scope = await resolveActiveScope().catch(() => ({
    organizations: [],
    projects: [],
    orgId: undefined,
    projectId: undefined
  }));
  const scopeSelectorEnabled = scope.organizations.length > 0;

  const scopeForm = (
    <form action={setActiveScopeAction} className="scope-form" aria-label="Scope selection">
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
    <main className="app-shell">
      <input type="checkbox" id="sidebar-toggle" className="sidebar-toggle" aria-hidden="true" />

      <aside className="sidebar-panel" aria-label="Sidebar">
        <div className="sidebar-brand">
          <span className="brand-mark">Branchline</span>
          <span className="brand-meta">Console v0.1</span>
        </div>

        <SidebarNav />

        <footer className="sidebar-footer">
          <span className="sidebar-footer-badge">Alpha v0.1</span>
        </footer>
      </aside>

      <label htmlFor="sidebar-toggle" className="sidebar-overlay" aria-label="Close navigation" />

      <section className="workspace-panel">
        <header className="topbar-panel" role="banner">
          <div className="topbar-main-row">
            <div className="topbar-left">
              <label htmlFor="sidebar-toggle" className="sidebar-toggle-button" aria-label="Open navigation" role="button" tabIndex={0}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </svg>
              </label>
              <TopbarBreadcrumbs />
            </div>

            <div className="topbar-right">
              <label className="search-field" aria-label="Search">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input type="search" placeholder="Search anything" readOnly value="" />
              </label>

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
              ) : authMode === "github" ? (
                <div className="auth-zone">
                  {githubSignedIn ? (
                    <>
                      <span className="topbar-note">{githubUserDisplayName}</span>
                      <a href="/api/auth/github/logout">Sign out</a>
                    </>
                  ) : (
                    <a href="/api/auth/github/start?returnTo=/">Sign in with GitHub</a>
                  )}
                </div>
              ) : (
                <span className="topbar-note">Auth setup required</span>
              )}
            </div>
          </div>

          {scopeSelectorEnabled ? (
            <div className="scope-row">
              {clerkEnabled ? <SignedIn>{scopeForm}</SignedIn> : authMode === "github" ? (githubSignedIn ? scopeForm : null) : scopeForm}
            </div>
          ) : null}
        </header>

        <div className="page-body">{children}</div>
      </section>
    </main>
  );

  return (
    <html lang="en" className={montserrat.variable}>
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
