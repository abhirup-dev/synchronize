// Kanban board view — "who's building what". Renders the room's tasks grouped
// into the four lifecycle columns. Ported from the Claude Design prototype
// (board.jsx); styling reuses the app's existing CSS tokens. Reads via the
// useTasks hook so it tracks live task state once the daemon serves tasks.

import { useMemo } from "react";
import type { Agent, Task, TaskStatus } from "../data/types.ts";
import { useAgents, useTasks } from "../data/context.tsx";
import { Avatar, IdentityBadge, IdentityText } from "./primitives.tsx";

interface Column {
  id: TaskStatus;
  label: string;
}

const COLUMNS: Column[] = [
  { id: "backlog", label: "BACKLOG" },
  { id: "doing", label: "IN PROGRESS" },
  { id: "review", label: "IN REVIEW" },
  { id: "shipped", label: "SHIPPED" },
];

export function BoardView({ roomId }: { roomId: string }) {
  const tasks = useTasks(roomId);
  const agents = useAgents();
  const agentById = useMemo(() => new Map(agents.map((a) => [a.id, a] as const)), [agents]);

  const byColumn = useMemo(() => {
    const grouped: Record<TaskStatus, Task[]> = { backlog: [], doing: [], review: [], shipped: [] };
    for (const task of tasks) grouped[task.status]?.push(task);
    return grouped;
  }, [tasks]);

  return (
    <div className="board-view" data-vim-panel="board">
      <div className="board-cols">
        {COLUMNS.map((col) => (
          <div className="board-col" data-status={col.id} key={col.id}>
            <div className="board-col-head">
              <span className="col-label">{col.label}</span>
              <span className="col-count">{byColumn[col.id].length}</span>
            </div>
            <div className="board-col-body">
              {byColumn[col.id].map((task) => (
                <TaskCard key={task.id} task={task} agentById={agentById} />
              ))}
              <button className="add-card" type="button" title="add task (visual demo)">+ add task</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TaskCard({ task, agentById }: { task: Task; agentById: Map<string, Agent> }) {
  const assignee = task.assigneeId ? agentById.get(task.assigneeId) : undefined;
  const priority = task.priority ?? "med";
  const reviewers = task.reviewerIds
    .map((id) => agentById.get(id))
    .filter((a): a is Agent => Boolean(a));

  return (
    <div className="task-card" data-priority={priority} data-status={task.status}>
      <div className="task-title">{task.title}</div>
      <div className="task-top">
        <span className="task-tag">{priority.toUpperCase()}</span>
        {task.tag ? <span className="task-tag-out">{task.tag}</span> : null}
      </div>

      {task.status === "doing" && typeof task.progress === "number" ? (
        <div className="task-progress">
          <IdentityBadge
            as="div"
            className="task-progress-fill"
            color={assignee?.color ?? "var(--ink)"}
            {...(assignee?.colorRef ? { colorRef: assignee.colorRef } : null)}
            style={{ width: `${Math.round(task.progress)}%` }}
          />
          <span className="task-progress-label">{Math.round(task.progress)}%</span>
        </div>
      ) : null}

      {task.status === "review" && reviewers.length > 0 ? (
        <div className="task-reviewers">
          <span className="reviewer-label">REVIEW:</span>
          <div className="reviewer-stack">
            {reviewers.map((r) => (
              <Avatar key={r.id} agent={r} size={22} />
            ))}
          </div>
        </div>
      ) : null}

      <div className="task-bottom">
        {assignee ? (
          <div className="task-assignee">
            <Avatar agent={assignee} size={24} showStatus />
            <IdentityText
              className="task-assignee-name identity-name-pill"
              color={assignee.color}
              {...(assignee.colorRef ? { colorRef: assignee.colorRef } : null)}
            >
              {assignee.name}
            </IdentityText>
          </div>
        ) : (
          <span className="task-assignee-name">unassigned</span>
        )}
        {task.status === "doing" && assignee?.status === "busy" ? (
          <span className="task-live-pill">● LIVE</span>
        ) : null}
        {task.status === "shipped" ? <span className="task-check">✓</span> : null}
      </div>
    </div>
  );
}
