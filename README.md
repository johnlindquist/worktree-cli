# @johnlindquist/worktree

A CLI tool for managing Git worktrees with a focus on opening them in the Cursor editor.

## Installation

```bash
pnpm install -g @johnlindquist/worktree
```

## Usage

### Create a new worktree from Branch Name

```bash
wt new <branchName> [options]
```
Options:
- `-p, --path <path>`: Specify a custom path for the worktree
- `-c, --checkout`: Create new branch if it doesn't exist and checkout automatically
- `-i, --install <packageManager>`: Package manager to use for installing dependencies (npm, pnpm, bun, etc.)
- `-e, --editor <editor>`: Editor to use for opening the worktree (overrides default editor)

Example:
```bash
wt new feature/login
wt new feature/chat --checkout
wt new feature/auth -p ./auth-worktree
wt new feature/deps -i pnpm
wt new feature/vscode -e code
```

### Create a new worktree from Pull Request Number

```bash
wt pr <prNumber> [options]
```
Uses the GitHub CLI (`gh`) to check out the branch associated with the given Pull Request number, sets it up locally to track the correct remote branch (handling forks automatically), and then creates a worktree for it.

**Benefit:** Commits made in this worktree can be pushed directly using `git push` to update the Pull Request.

**Requires GitHub CLI (`gh`) to be installed and authenticated.**

Options:
- `-p, --path <path>`: Specify a custom path for the worktree (defaults to `<repoName>-<branchName>`)
- `-i, --install <packageManager>`: Package manager to use for installing dependencies (npm, pnpm, bun, etc.)
- `-e, --editor <editor>`: Editor to use for opening the worktree (overrides default editor)

Example:
```bash
# Create worktree for PR #123
wt pr 123

# Create worktree for PR #456, install deps with pnpm, open in vscode
wt pr 456 -i pnpm -e code
```

### Configure Default Editor

You can set a default editor to be used when creating new worktrees:

```bash
# Set default editor
wt config set editor <editorName>

# Examples:
wt config set editor code     # Use VS Code
wt config set editor webstorm # Use WebStorm
wt config set editor cursor   # Use Cursor (default)

# Get current default editor
wt config get editor

# Show config file location
wt config path
```

The default editor will be used when creating new worktrees unless overridden with the `-e` flag.

### Setup Worktree Commands

You can define setup commands in one of two locations to automatically execute them when creating a new worktree:

1. **Cursor's format**: `.cursor/worktrees.json` in the repository root
2. **Generic format**: `worktrees.json` in the repository root

The tool checks for `.cursor/worktrees.json` first, then falls back to `worktrees.json`.

#### Format Options:

**Option 1: `worktrees.json` (recommended for new projects):**
```json
{
  "setup-worktree": [
    "npm install",
    "cp $ROOT_WORKTREE_PATH/.local.env .local.env",
    "echo 'Setup complete'"
  ]
}
```

**Option 2: `.cursor/worktrees.json` (Cursor's native format):**
```json
[
  "npm install",
  "cp $ROOT_WORKTREE_PATH/.local.env .local.env",
  "echo 'Setup complete'"
]
```

- Commands are executed in the new worktree directory.
- The `$ROOT_WORKTREE_PATH` environment variable is available, pointing to the main repository root.
- Commands run with shell execution, so complex commands and piping are supported.
- If a command fails, the error is logged, but setup continues with the next command.
- The setup runs after worktree creation but before dependency installation (if `--install` is used).

### List worktrees

```bash
wt list
```

### Remove a worktree

```bash
wt remove <pathOrBranch>
```

You can remove a worktree by either its path or branch name:
```bash
wt remove ./feature/login-worktree
wt remove feature/chat
```

## Requirements

- Git
- Node.js
- An editor installed and available in PATH (defaults to Cursor)
- **GitHub CLI (`gh`) installed and authenticated (for `wt pr` command)**

## Development

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Run in development mode
pnpm dev
```

## License

MIT 