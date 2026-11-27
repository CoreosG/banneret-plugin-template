import type { ToolOutput } from "../../vendor/kit/src/index.ts";
import type { Register } from "../registry.ts";

export function createBoard() {
  const card: ToolOutput<"tasks_read"> = {
    task: {
      id: "T1",
      title: "Try a plugin",
      ref: {
        tracker: "demo",
        scope: "demo",
        key: "T1",
        url: "https://example.org/tasks/T1",
      },
      openedAt: new Date().toISOString(),
      closedAt: null,
    },
    kind: "task",
    column: "ready",
    status: "open",
    statusWhy: "Ready to claim",
    assignees: [],
    prs: [],
    restsOn: [],
  };
  function read(id: string) {
    if (id !== card.task.id) throw new Error("Unknown task");
    return card;
  }
  return function registerTasks(add: Register, actor: string) {
    add("tasks_list_boards", () => ({
      boards: [{ id: "demo", title: "Demo board" }],
    }));
    add("tasks_list_tasks", ({ boardId }) => {
      if (boardId !== "demo") throw new Error("Unknown board");
      return { tasks: [card] };
    });
    add("tasks_read", ({ taskId }) => read(taskId));
    add("tasks_claim", ({ taskId }) => {
      const task = read(taskId);
      if (task.lease)
        return {
          status: task.lease.holder.id === actor ? "claimed" : "conflict",
        };
      const now = new Date().toISOString();
      task.lease = {
        holder: { id: actor, login: actor },
        state: "active",
        since: now,
        lastSignalAt: now,
        staleAt: "9999-12-31T23:59:59Z",
        expiresAt: "9999-12-31T23:59:59Z",
      };
      return { status: "claimed" };
    });
    add("tasks_release", ({ taskId, reason, freeToContinue, note }) => {
      const task = read(taskId);
      if (task.lease?.holder.id !== actor) return { status: "not_holder" };
      task.lastRelease = {
        by: task.lease.holder,
        at: new Date().toISOString(),
        reason,
        freeToContinue,
        note,
      };
      delete task.lease;
      return { status: "released" };
    });
  };
}
