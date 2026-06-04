# @seomi/ssh

**English** | [Русский](https://github.com/Mikeekb/seomi-ssh/blob/main/README.ru.md)

> One command sets up passwordless SSH access for an AI agent to your servers.

`@seomi/ssh` is a CLI installer: in a single interactive pass it configures key-based SSH
access for an agent to one or more servers (dev / prod / custom) and writes an access map
into the agent instructions (`AGENTS.md` / `CLAUDE.md`). It's a lightweight sibling of
[`@seomi/wp-mcp`](https://github.com/Mikeekb/seomi-wp-mcp) — the SSH wizard and agent-instruction
logic, without the WordPress and MCP parts.

```bash
npm install -g @seomi/ssh
cd my-project
seomi-ssh init
```

## Features

- **`init`** — interactive setup. Asks about servers **in a loop** (role, host, user, port,
  key path, optional working directory) and repeats "add another?" until you decline.
  Supports any number of servers: prod only; dev + prod; or an arbitrary set.
- **SSH wizard per server** — generates an ed25519 key (or reuses one), copies the public
  key (`ssh-copy-id` → ssh-pipe fallback), verifies with `ssh -o BatchMode=yes`, and on
  failure prints a manual hint with the `.pub` contents.
- **Writes agent instructions** — a managed block with a server map and ready-to-use
  `ssh` / `scp` / `rsync` examples, values pulled from `.claude/.env`.
- **`aif-ssh` skill** — copied into the project's `.claude/skills/` so the agent knows how
  to use the configured access.
- **Idempotent** — re-running never duplicates keys, env entries, or the managed block.

> `update` and `doctor` are declared in `--help` but are not implemented yet (stubs).

## Commands

| Command | What it does |
|---------|--------------|
| `seomi-ssh init` | Interactive setup (see above) |
| `seomi-ssh init --dry-run` | Run the prompts without touching disk or SSH; preview the block |
| `seomi-ssh init --verbose` | Add debug-level logging |
| `seomi-ssh --help` | Show usage |
| `seomi-ssh --version` | Print version |
| `seomi-ssh update` / `doctor` | Reserved (not implemented yet) |

## Requirements

- **Node 20+** for the CLI itself.
- **OpenSSH client** (`ssh`, `ssh-keygen`) on the local machine. `ssh-copy-id` is optional —
  without it (typical on Windows OpenSSH) the wizard uses a portable ssh-pipe fallback.

## How the SSH wizard works

For each server, a strategy chain with graceful degradation:

1. **Keygen** — generate `ed25519` if the key is missing (`ssh-keygen -N ''`, empty passphrase
   so the agent can authenticate non-interactively), otherwise reuse the existing key.
2. **Copy** — `ssh-copy-id` (asks for the password once). If the binary isn't on PATH, fall
   back to piping the public key into `~/.ssh/authorized_keys` over `ssh` (deduplicated).
3. **Verify** — `ssh -o BatchMode=yes ... 'echo ok'`. BatchMode disables password prompts,
   so a non-zero exit reliably means the key wasn't accepted.
4. **Fallback** — on failed verification, print a manual hint with the `.pub` contents.

A failure on one server doesn't abort the run — the others continue.

## Configuration

Connection parameters live in `.claude/.env` (gitignored) as flat keys with a **role prefix**.
One server = one key group:

| Key | Purpose | Written |
|-----|---------|---------|
| `SSH_<PREFIX>_HOST` | domain or IP | always |
| `SSH_<PREFIX>_USER` | SSH user | always |
| `SSH_<PREFIX>_PORT` | port | if provided |
| `SSH_<PREFIX>_KEY`  | private key path | always |
| `SSH_<PREFIX>_ROOT` | remote working directory | if provided |
| `SSH_SERVERS` | csv registry of all prefixes | always |

`<PREFIX>` is the role normalized to `UPPER_SNAKE_CASE` (`prod` → `PROD`, `staging-eu` →
`STAGING_EU`); duplicate roles get a unique suffix (`PROD`, then `PROD_2`). `.claude/.env`
is the **first place** the agent looks for access details — not `~/.ssh/config`.

## Example

```bash
$ seomi-ssh init
› Step 1: Server prompts
? Server role › prod
? [prod] Host (domain or IP) › prod.example.com
? [prod] SSH user › ai-agent
? Add another server? › No
› Step 2: SSH keys
[ok] "prod": key configured and verified
› Step 4: Agent instructions (AGENTS.md / CLAUDE.md)
[ok] created: AGENTS.md
```

---

## Documentation

| Guide | Description |
|-------|-------------|
| [`init` command](https://github.com/Mikeekb/seomi-ssh/blob/main/docs/init.md) | SSH setup behavior, `.claude/.env` configuration, examples, troubleshooting |

## License

Proprietary — © SEOMI. See `LICENSE`.

## Related projects

- [@seomi/wp-mcp](https://github.com/Mikeekb/seomi-wp-mcp) — the WordPress/MCP sibling this package is derived from.
- [ai-factory](https://github.com/lee-to/ai-factory) — companion project for AI dev context.

---

Built and maintained by [SEOmi.ru — Web Development](https://seomi.ru/).
