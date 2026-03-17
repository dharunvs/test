import Link from "next/link";

export default function HomePage() {
  return (
    <>
      <section className="card">
        <h1>A minimal operating surface for AI-native teams.</h1>
        <p>
          Set scope, monitor active work, and make review decisions without leaving a single, calm control
          plane.
        </p>
        <span className="badge">MVP F1-F11 Workflow</span>
      </section>
      <section className="grid">
        <article className="card">
          <h2>Control Plane</h2>
          <p>Organization setup, members, repositories, and policy versions.</p>
          <p>
            <Link href={"/onboarding" as never}>Onboarding</Link> | <Link href={"/team" as never}>Team</Link> |{" "}
            <Link href={"/repositories" as never}>Repositories</Link> | <Link href="/projects">Policies</Link>
          </p>
        </article>
        <article className="card">
          <h2>Execution State</h2>
          <p>Realtime activity, task conflicts, branch state, and quality drilldowns.</p>
          <p>
            <Link href="/activity">Activity</Link> | <Link href={"/tasks" as never}>Tasks</Link> |{" "}
            <Link href={"/quality" as never}>Quality</Link>
          </p>
        </article>
        <article className="card">
          <h2>Traceability</h2>
          <p>Replay, provenance, and audit verification for reviewer confidence.</p>
          <p>
            <Link href="/provenance">Provenance</Link> | <Link href="/replay">Replay</Link> |{" "}
            <Link href={"/audit" as never}>Audit</Link>
          </p>
        </article>
      </section>
    </>
  );
}
