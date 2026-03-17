import { SignIn } from "@clerk/nextjs";

import { isClerkConfigured, missingClerkConfigMessage } from "../../../lib/clerk";

export default function SignInPage() {
  if (!isClerkConfigured()) {
    return (
      <section className="card">
        <h1>Sign In</h1>
        <p>{missingClerkConfigMessage}</p>
      </section>
    );
  }

  return (
    <section className="card">
      <SignIn forceRedirectUrl="/" />
    </section>
  );
}
