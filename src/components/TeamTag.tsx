// Which team something belongs to, when several are at work. Deliberately plain (gray text, no
// per-team colors): the 관제탑 keeps color for what needs attention — the accent and problems.
import type { Project } from "../lib/api";

export function TeamTag({ project, className = "" }: { project: Project; className?: string }) {
  return (
    <span className={`min-w-0 shrink-0 truncate text-[11px] font-medium text-ink-2 ${className}`} title={project.name}>
      {project.name}
    </span>
  );
}
