import Link from "next/link";
import { resolveActiveScope } from "../../lib/api";

export default async function ProjectsPage() {
  const scope = await resolveActiveScope().catch((error) => ({
    organizations: [],
    projects: [],
    orgId: undefined,
    projectId: undefined,
    error: error instanceof Error ? error.message : "Unknown error"
  }));

  return (
    <section className="card">
      <h1>Projects</h1>
      <p>Project-level controls for branch policies and AI workflow behavior.</p>
      {"error" in scope ? <p>{scope.error}</p> : null}
      <ul>
        {"projects" in scope &&
          scope.projects.map((project) => (
          <li key={project.id}>
            <strong>{project.name}</strong> ({project.key}) - base {project.defaultBaseBranch ?? "main"}
            {" - "}
            <Link href={`/projects/${project.id}/policy`}>policy</Link>
            {" - "}
            <Link href={`/projects/${project.id}/knowledge` as never}>knowledge hub</Link>
          </li>
          ))}
      </ul>
    </section>
  );
}
