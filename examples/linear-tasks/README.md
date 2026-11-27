# Linear task provider

Serve Linear teams as boards and issues as tasks through Banneret's five MCP task tools. Each request uses the caller's own Linear permissions.

## Setup

From the repository root, install the starter's prerequisites and run:

```sh
pnpm install --frozen-lockfile
LINEAR_AGENT=codex node examples/linear-tasks/main.ts
```

The endpoint is `http://127.0.0.1:8787/mcp`. Set `PORT` to change the port. Use the example's `plugin.json` and route tasks to `external:linear` when configuring a Hub that supports external providers. For direct MCP use, configure the same endpoint and bearer credential.

Each user creates a personal key in Linear's Security & access settings with permission to read teams and issues, change assignments and create comments. Supply that key as the user's Hub plugin credential. The plugin extracts it from the incoming bearer header and forwards it as a raw Authorization header to Linear over HTTPS. Keep the key out of tool inputs, logs and the manifest. Use HTTPS on any remote connection to the plugin. [Linear API authentication](https://linear.app/developers/graphql)

## Mapping

| Linear | Banneret |
| --- | --- |
| Team UUID and name | Board ID and title |
| Issue UUID and title | Stable task ID and title (first 300 UTF-16 code units) |
| Team UUID, issue identifier and URL | Task reference scope, key and URL, with tracker `linear` |
| Created, completed or canceled timestamp | Opened and closed timestamps. Open issues have a null close time. |
| Workflow state type and name | Type supplies column and status. Name supplies statusWhy. Kind is `task`. |
| Current assignee | Zero or one assignees. The person ID is the Linear user UUID. Login uses displayName when it fits the kit's login format, otherwise the UUID. |

Lists follow Linear's pagination and default archive visibility. The example omits lease timestamps, release history, previews and sign-offs and returns empty PR and dependency lists.

## Claims and limits

The caller is Linear's authenticated viewer. An existing holder can retry successfully without adding another comment. A different assignee produces a conflict. For an unassigned issue, the plugin assigns the viewer, re-reads the assignee and returns a conflict if ownership changed. It leaves the competing assignment alone. After a successful verification it comments `claim: <login>/<agent>`. The task contract supplies no agent identity, so the operator sets the label with `LINEAR_AGENT` (default `banneret`).

**The race is not closed.** Linear offers no conditional assignment here. Two callers can each observe their own assignment and both report success. The manifest declares both the kit's `atomicClaim: false` and `atomicClaims: false`.

Release checks for the caller's assignment, clears it and comments `release: <reason>`. A non-holder gets `not_holder`. A reassignment between the check and the clear can be overwritten. Release does not change workflow state or persist the optional note or freeToContinue flag. Comments are separate writes. If a comment fails, the tool reports an error and the assignment change can already have taken effect.

## Verify

Run `pnpm check` from the repository root. The vendored conformance checker uses two fake users against a disposable loopback GraphQL fixture. A second test forces a competing assignment during claim verification. Neither needs a Linear account or contacts Linear.
