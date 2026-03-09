# Copilot SDK Integration

Gas Town supports [GitHub Copilot SDK](https://github.com/github/copilot-sdk) as a
first-class agent runtime alongside Claude Code, Gemini, Codex, and others. The
integration is built on the Go SDK (`github.com/github/copilot-sdk/go`) and runs as
the `gt copilot run` command.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  gt copilot run                                     │
│                                                     │
│  ┌──────────────┐    ┌──────────────────────────┐   │
│  │ Worker Loop  │───▶│ Mail Poller              │   │
│  │ (cmd/copilot)│    │ gt mail check --json     │   │
│  └──────┬───────┘    └──────────────────────────┘   │
│         │                                           │
│  ┌──────▼───────┐    ┌──────────────────────────┐   │
│  │ Prompt       │───▶│ Role Templates           │   │
│  │ Builder      │    │ (Mayor, Polecat, Crew…)  │   │
│  └──────┬───────┘    └──────────────────────────┘   │
│         │                                           │
│  ┌──────▼───────┐    ┌──────────────────────────┐   │
│  │ Runner       │───▶│ copilotapi.Client        │   │
│  │ (runner.go)  │    │ → Session.SendAndWait()  │   │
│  └──────┬───────┘    └──────────────────────────┘   │
│         │                                           │
│  ┌──────▼───────┐                                   │
│  │ Security     │  PreToolUse: workspace sandbox    │
│  │ Hooks        │  PostToolUse: activity logging    │
│  └──────────────┘                                   │
└─────────────────────────────────────────────────────┘
           │
           ▼
   Copilot CLI Server (manages LLM communication)
```

### Key Components

| Component | File | Purpose |
|-----------|------|---------|
| **Runner** | `internal/agent/copilot/runner.go` | Manages Copilot SDK client, sessions, and security hooks |
| **CLI Command** | `internal/cmd/copilot.go` | `gt copilot run` — worker loop with mail polling and prompt rendering |
| **Agent Preset** | `internal/config/agents.go` | Registers `copilot` as a built-in agent preset |

## Usage

### Quick Start

```bash
# In a Gas Town workspace, run the Copilot worker loop
cd ~/gt/myproject/polecats/alpha/rig
gt copilot run
```

The worker loop:
1. Polls `gt mail check --json` for new messages
2. When mail arrives, renders a role-appropriate system prompt
3. Builds a context prompt via `gt prime --dry-run` and `gt mail check --inject`
4. Sends the prompt to the Copilot SDK session via `SendAndWait()`
5. Sleeps for `--poll-interval` and repeats

### One-Shot Mode

```bash
# Execute a single task and exit
gt copilot run --once
```

### Command Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--once` | `false` | Run one task and exit instead of looping |
| `--poll-interval` | `15s` | How often to check for new mail |
| `--timeout` | `10m` | Maximum time for a single Copilot run |
| `--model` | *(CLI default)* | Copilot model ID to use |
| `--cli-path` | *(auto)* | Path to the Copilot CLI binary |
| `--cli-url` | *(auto)* | Connect to an existing Copilot CLI server URL |
| `--log-level` | `info` | Copilot CLI log level |
| `--log-file` | `.logs/copilot-<role>.log` | Log file for tool activity |
| `--allow-all-tools` | `true` | Allow all Copilot tools (within sandbox) |

## Configuration

### Setting Copilot as Default Runtime

In your rig's `settings/config.json`:

```json
{
  "runtime": {
    "provider": "copilot",
    "command": "gt",
    "args": ["copilot", "run"],
    "prompt_mode": "none"
  }
}
```

### Using with `gt sling`

```bash
# Sling work to a polecat using Copilot runtime
gt sling gt-abc12 myproject --agent copilot
```

### Agent Preset

The `copilot` preset is registered in the agent registry alongside `claude`,
`gemini`, `codex`, `cursor`, `auggie`, `amp`, and `opencode`:

```go
AgentCopilot AgentPreset = "copilot"
```

## Session Management

The runner persists session state to `.runtime/copilot-session.json` inside the
working directory. On subsequent runs:

1. **Resume** — If a session file exists, the runner attempts to resume using
   `client.ResumeSessionWithOptions()`.
2. **Create** — If resume fails (or no session exists), a new session is created
   with the role-specific system prompt.

Session state is a simple JSON file:

```json
{
  "session_id": "sess_abc123..."
}
```

This enables Copilot workers to maintain context across restarts, matching the
same persistence model Gas Town provides for Claude Code via hooks.

## Security: Workspace Sandboxing

The runner installs `PreToolUse` and `PostToolUse` hooks on every session:

### PreToolUse Hook

Before any tool executes, the hook:
1. Extracts file paths from tool arguments (`path`, `paths`, `file`, `files`,
   `directory`, `root` keys).
2. Normalizes each path (resolves relative paths against the work directory).
3. Verifies every path is within the work directory boundary.
4. **Denies** the tool call if any path escapes the workspace.

This enforces the Gas Town principle of workspace boundaries — agents cannot
write outside their assigned rig/worktree.

### PostToolUse Hook

After tool execution, the hook logs the tool name and arguments to the activity
log file for observability and debugging.

### Disabling Tools

Set `--allow-all-tools=false` to deny all tool usage. This is useful for
dry-run testing or read-only analysis tasks.

## Prompt Pipeline

The Copilot runner uses the same role-template system as all Gas Town runtimes:

1. **System Prompt** — Rendered from role templates (`templates/` package) with
   rig context (town name, rig name, work dir, default branch, beads dir, etc.).
   Falls back to a generic prompt if template rendering fails.

2. **User Prompt** — Built from:
   - `gt prime --dry-run` output (workspace context recovery)
   - `gt mail check --inject` output (pending messages)
   - Standard instructions to check the mail inbox

This means a Copilot-powered Polecat receives the same role instructions and
context as a Claude-powered one — the runtime is interchangeable.

## Logging

Tool activity is logged to `.logs/copilot-<role>.log` in the working directory.
Each log entry includes the tool name and arguments, prefixed with `[copilot]`
and a timestamp.

Override the log path with `--log-file`:

```bash
gt copilot run --log-file /tmp/copilot-debug.log
```

## Prerequisites

- **GitHub Copilot CLI** — The Copilot CLI server must be available. Install via
  [docs.github.com/en/copilot](https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli).
- **GitHub Copilot subscription** — An active Copilot license is required.
- **Go 1.23+** — For building Gas Town with the Copilot SDK dependency.

## Dependencies

The integration adds one Go dependency:

```
github.com/github/copilot-sdk/go
```

This is the official Go SDK for GitHub Copilot, providing `Client`, `Session`,
and hook types used by the runner.

## See Also

- [README — Copilot SDK Workflow](../README.md#copilot-sdk-workflow) — Quick-start in the main README
- [overview.md](overview.md) — Gas Town conceptual overview
- [architecture.md](design/architecture.md) — Two-level beads architecture
- [reference.md](reference.md) — Full command reference
