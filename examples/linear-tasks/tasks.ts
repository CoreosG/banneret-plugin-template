import { z } from "zod";
import type { Register } from "../../src/registry.ts";

const user = z.object({ id: z.string(), displayName: z.string() });
const team = z.object({ id: z.string(), name: z.string() });
const issue = z.object({
  id: z.string(), title: z.string(), identifier: z.string(), url: z.string(),
  createdAt: z.string(), completedAt: z.string().nullable(), canceledAt: z.string().nullable(),
  state: z.object({ type: z.string(), name: z.string() }),
  team: z.object({ id: z.string() }), assignee: user.nullable(),
});
const fields = `id title identifier url createdAt completedAt canceledAt
  state { type name } team { id } assignee { id displayName }`;
const pageFields = "pageInfo { hasNextPage endCursor }";
function page<T extends z.ZodType>(node: T) {
  return z.object({
    nodes: z.array(node),
    pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
  });
}
async function pages<T>(read: (after: string | null) => Promise<{
  nodes: T[], pageInfo: { hasNextPage: boolean, endCursor: string | null }
}>) {
  const result: T[] = [];
  let after: string | null = null;
  for (;;) {
    const { nodes, pageInfo } = await read(after);
    result.push(...nodes);
    if (!pageInfo.hasNextPage) return result;
    if (!pageInfo.endCursor || pageInfo.endCursor === after) throw new Error("Invalid Linear cursor");
    after = pageInfo.endCursor;
  }
}
function person(actor: z.infer<typeof user>) {
  const login = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(actor.displayName) ? actor.displayName : actor.id;
  return { id: actor.id, login };
}
function card(row: z.infer<typeof issue>) {
  return {
    task: {
      id: row.id, title: row.title.slice(0, 300),
      ref: { tracker: "linear", scope: row.team.id, key: row.identifier, url: row.url },
      openedAt: row.createdAt, closedAt: row.completedAt ?? row.canceledAt,
    },
    kind: "task", column: row.state.type, status: row.state.type,
    statusWhy: row.state.name.slice(0, 240), assignees: row.assignee ? [person(row.assignee)] : [],
    prs: [], restsOn: [],
  };
}

export function registerTasks(add: Register, endpoint: string, key: string, agent: string) {
  async function query<T extends z.ZodType>(schema: T, document: string, variables: Record<string, unknown>) {
    const response = await fetch(endpoint, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(15000),
      headers: { Authorization: key, "Content-Type": "application/json" },
      body: JSON.stringify({ query: document, variables }),
    });
    if (!response.ok) throw new Error(`Linear returned HTTP ${response.status}`);
    const body = await response.json();
    if (body.errors?.length) throw new Error("Linear rejected the operation");
    const parsed = schema.safeParse(body.data);
    if (!parsed.success) throw new Error("Unexpected Linear response");
    return parsed.data;
  }
  const ownership = (id: string) => query(
    z.object({ viewer: user, issue: z.object({ assignee: z.object({ id: z.string() }).nullable() }) }),
    "query Ownership($id: String!) { viewer { id displayName } issue(id: $id) { assignee { id } } }", { id },
  );
  const success = z.object({ success: z.literal(true) });
  const assign = (id: string, assigneeId: string | null) => query(
    z.object({ issueUpdate: success }),
    "mutation Assign($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success } }",
    { id, input: { assigneeId } },
  );
  const comment = (issueId: string, body: string) => query(
    z.object({ commentCreate: success }),
    "mutation Comment($input: CommentCreateInput!) { commentCreate(input: $input) { success } }",
    { input: { issueId, body } },
  );
  add("tasks_list_boards", async () => {
    const teams = await pages(async (after) => (await query(
      z.object({ teams: page(team) }),
      `query Teams($after: String) { teams(first: 50, after: $after) { nodes { id name } ${pageFields} } }`, { after },
    )).teams);
    return { boards: teams.map(({ id, name }) => ({ id, title: name })) };
  });
  add("tasks_list_tasks", async ({ boardId }) => {
    const rows = await pages(async (after) => (await query(
      z.object({ team: z.object({ issues: page(issue) }) }),
      `query Issues($id: String!, $after: String) { team(id: $id) { issues(first: 50, after: $after) { nodes { ${fields} } ${pageFields} } } }`,
      { id: boardId, after },
    )).team.issues);
    return { tasks: rows.map(card) };
  });
  add("tasks_read", async ({ taskId }) => card((await query(
    z.object({ issue }), `query Issue($id: String!) { issue(id: $id) { ${fields} } }`, { id: taskId },
  )).issue));
  add("tasks_claim", async ({ taskId }) => {
    const { viewer, issue } = await ownership(taskId);
    if (issue.assignee) return { status: issue.assignee.id === viewer.id ? "claimed" : "conflict" };
    await assign(taskId, viewer.id);
    if ((await ownership(taskId)).issue.assignee?.id !== viewer.id) return { status: "conflict" };
    await comment(taskId, `claim: ${person(viewer).login}/${agent}`);
    return { status: "claimed" };
  });
  add("tasks_release", async ({ taskId, reason }) => {
    const { viewer, issue } = await ownership(taskId);
    if (issue.assignee?.id !== viewer.id) return { status: "not_holder" };
    await assign(taskId, null);
    await comment(taskId, `release: ${reason}`);
    return { status: "released" };
  });
}
