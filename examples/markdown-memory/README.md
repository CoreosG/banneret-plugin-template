# Shared Markdown memory

Use a dedicated folder for a company's project notes, such as a git checkout of team rules. Personal notes belong in the user's own Hub. Route only shared project memory here. Never send a personal notebook, mixed export or personal tool arguments to a company server. The provider rejects personal proposals and excludes personal files from all five tools.

## Setup

From the repository root, install dependencies and start the loopback MCP server. Supply credentials through the environment. This example generates one bearer token for a chat.

```sh
pnpm install --frozen-lockfile
export MEMORY_FOLDER="$PWD/team-rules"
export TEAM_TOKEN="$(openssl rand -hex 32)"
export MEMORY_CHAT_TOKENS="$(node -p 'JSON.stringify({[process.env.TEAM_TOKEN]:"release-chat"})')"
node examples/markdown-memory/main.ts
```

Connect to `http://127.0.0.1:8787/mcp` with the token in the bearer authorization header. Set `PORT` to change the port. The manifest advertises `external:markdown-memory` for memory. Each token maps to a stable chat ID supplied by the operator. All authorized chats share the same project folder. Configure a distinct credential for each chat and use HTTPS if proxying remote requests.

Run one provider process per folder. Stop it before human edits, git pulls or switching branches. The operator manages git commits and synchronization. Use a dedicated folder because the provider regenerates its index at startup and after proposals.

## File format and review

Each `note-<key>.md` uses the Hub ME4 export format. YAML frontmatter contains name, description, type, key, kind, scope, source, created, confirmedAt, lastUsedAt, useCount, pinned, disputedAt, disputeReason and trust. Dates are milliseconds since the Unix epoch. The Markdown body contains the note text. `MEMORY.md` contains the Hub index marker and sorted links to shared notes.

Search matches substrings in the key, text or source, ignoring case. Propose creates a new key for human review. Flag records a reason and dispute timestamp. Only a human reviewing the folder can confirm a proposal or clear a dispute. Use refreshes lastUsedAt and counts each chat once per key. After the first use, an optional useChatHashes list in the frontmatter makes retries idempotent across restarts. A Hub export preserves the starting count but omits prior chat identities, so deduplication starts when the folder takes over.

Read and search derive trust from the current time and metadata. An open dispute takes precedence, followed by an unconfirmed proposal, then a pin. Confirmed notes become stale after 45 idle days and archived after 90. Other confirmed notes become trusted after three distinct uses and 30 days since creation or the last dispute. The Hub imports these files as fresh proposals for its own review.

Run `pnpm check` from the repository root to exercise the ME4 fixture and run the vendored checker against a temporary folder.
