import { SignUp } from "@clerk/nextjs";

import { isClerkConfigured, missingClerkConfigMessage } from "../../../lib/clerk";

export default function SignUpPage() {
  if (!isClerkConfigured()) {
    return (
      <section className="card">
        <h1>Sign Up</h1>
        <p>{missingClerkConfigMessage}</p>
      </section>
    );
  }

  return (
    <section className="card">
      <SignUp forceRedirectUrl="/" />
    </section>
  );
}
