# Banneret plugin template

A Banneret plugin runs as a separate MCP server. Its `plugin.json` tells the Hub which capabilities it offers and how it authenticates callers. This starter serves a task board, a Markdown skill and a notebook over Streamable HTTP.

## Run locally

Install Node.js 22.18 or newer and pnpm 10.32.1. Clone this repository, open its directory and run:

```sh
pnpm install --frozen-lockfile
pnpm start
```

Connect an MCP client to `http://127.0.0.1:8787/mcp` with the header `Authorization: Bearer demo-alice`. Set `PORT` to change the listening port. Call `tasks_list_boards` and list the tasks on board `demo` to find task `T1`. A second demo credential, `demo-bob`, can see the same board and compete for a claim. Both identities have a private notebook in a single demo workspace, project and chat. Restarting the server resets the fakes.

## Build your provider

Set your source ID and description in `plugin.json`. Keep the capabilities you want. Remove unused provider modules from `src/providers`, their imports and setup in `src/server.ts`, and any corresponding tests. The registry validates tool inputs and outputs against the kit. Keep skills available through both their tool and resource URI.

Replace the fixture tokens and fixed context with authenticated identity, workspace, project and chat before deploying. Connect your own storage and enforce permissions there. The demo's synchronous task claim is atomic inside its single process. Set `atomicClaim` according to what your production store guarantees across competing callers.

## Connect to Banneret Hub

Solo's **Add a plugin by URL** flow is planned. The relay contract lets an operator assign one owner per capability. For this manifest, select `external:starter` for each of `tasks`, `skills` and `memory` that should use this server. If you change the manifest source, change the owner suffix to match. Other capabilities can keep their current owners. The contract revision used here specifies that mapping. Relay registration of an endpoint and credentials is still pending at that revision. Today, use an MCP client or the checker to connect directly.

## Verify

```sh
pnpm check
```

This typechecks, lints, runs unit tests and executes the upstream checker against a fresh loopback server on a free port. To run only conformance, use `pnpm conformance`. It checks tool discovery, skill resources, competing task claims and the memory proposal lifecycle. To use a standalone checker downloaded from the fork releases:

```sh
BANNERET_CHECKER=/absolute/path/to/banneret-plugin-check.mjs pnpm conformance
```

To exercise a running demo server yourself:

```sh
BANNERET_CHECK_TOKEN=demo-alice BANNERET_CHECK_PEER_TOKEN=demo-bob \
  node vendor/kit/checker/cli.mjs --manifest plugin.json --task-id T1 \
  --url http://127.0.0.1:8787/mcp
```

## Contract and updates

The fork's TypeScript kit is an unpublished workspace package. We vendor its Zod schemas and the upstream checker source together so a clean installation can test the same contract without a monorepo checkout or a release download. The exact fork commit and upstream MIT license are in `vendor/kit`. To update both from a fork tag that contains the checker, run `bash scripts/refresh-kit.sh TAG`, inspect the changes and run `pnpm check`. A full commit SHA also works.

[Plugin contract](https://github.com/CoreosG/banneret-hub/blob/main/docs/banneret/plugins.md) · [Kit and checker source](https://github.com/CoreosG/banneret-hub/tree/main/packages/banneret-plugin-kit) · [Fork releases](https://github.com/CoreosG/banneret-hub/releases)

See the [Linear task provider](examples/linear-tasks/README.md) for an example backed by Linear teams and issues.

See the [shared Markdown memory provider](examples/markdown-memory/README.md) to serve company project notes from a git-backed folder.
