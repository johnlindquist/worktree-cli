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

### Create a new worktree with setup scripts

```bash
wt setup <branchName> [options]
```

Creates a new worktree and automatically runs setup commands from `worktrees.json` or `.cursor/worktrees.json`. This is useful for automating dependency installation, copying configuration files, or running custom setup scripts.

Options:
- `-p, --path <path>`: Specify a custom path for the worktree
- `-c, --checkout`: Create new branch if it doesn't exist and checkout automatically
- `-i, --install <packageManager>`: Package manager to use for installing dependencies (npm, pnpm, bun, etc.)
- `-e, --editor <editor>`: Editor to use for opening the worktree (overrides default editor)

Example:
```bash
wt setup feature/new-feature
wt setup feature/quick-start -i pnpm
```

### Create a new worktree from Pull Request / Merge Request

```bash
wt pr <prNumber> [options]
```
Uses the GitHub CLI (`gh`) or GitLab CLI (`glab`) to check out the branch associated with the given Pull Request or Merge Request number, sets it up locally to track the correct remote branch (handling forks automatically), and then creates a worktree for it.

**Benefit:** Commits made in this worktree can be pushed directly using `git push` to update the PR/MR.

**Requires GitHub CLI (`gh`) or GitLab CLI (`glab`) to be installed and authenticated.**

The tool automatically detects whether you're working with a GitHub or GitLab repository based on the remote URL.

Options:
- `-p, --path <path>`: Specify a custom path for the worktree (defaults to `<repoName>-<branchName>`)
- `-i, --install <packageManager>`: Package manager to use for installing dependencies (npm, pnpm, bun, etc.)
- `-e, --editor <editor>`: Editor to use for opening the worktree (overrides default editor)
- `-s, --setup`: Run setup scripts from `worktrees.json` or `.cursor/worktrees.json`

Example:
```bash
# Create worktree for GitHub PR #123
wt pr 123

# Create worktree for GitLab MR #456 with deps and editor
wt pr 456 -i pnpm -e code

# Create worktree and run setup scripts
wt pr 123 --setup
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
wt config set editor none     # Skip opening editor entirely

# Get current default editor
wt config get editor

# Show config file location
wt config path
```

The default editor will be used when creating new worktrees unless overridden with the `-e` flag.

Setting the editor to `none` will skip opening any editor after creating a worktree, which is useful for CI/CD pipelines or scripts.

### Configure Git Provider

You can manually set the git provider for `wt pr` if auto-detection doesn't work:

```bash
# Set git provider
wt config set provider gh    # GitHub CLI
wt config set provider glab  # GitLab CLI

# Get current provider
wt config get provider
```

### Configure Default Worktree Directory

You can set a global directory where all worktrees will be created:

```bash
# Set default worktree directory
wt config set worktreepath <path>

# Examples:
wt config set worktreepath ~/worktrees        # Use ~/worktrees
wt config set worktreepath /Users/me/dev/.wt   # Use absolute path

# Get current default worktree directory
wt config get worktreepath

# Clear the setting (revert to sibling directory behavior)
wt config clear worktreepath
```

**Path Resolution Priority:**
1. `--path` flag (highest priority)
2. `defaultWorktreePath` config setting
3. Sibling directory behavior (default fallback)

**Behavior Examples:**

Without global path configured (default):
- Current directory: `/Users/me/projects/myrepo`
- Command: `wt new feature/login`
- Creates: `/Users/me/projects/myrepo-login`

With global path configured (`~/worktrees`):
- Current directory: `/Users/me/projects/myrepo`
- Command: `wt new feature/login`
- Creates: `~/worktrees/login`

### Setup Worktree Configuration

You can define setup commands in one of two locations to automatically execute them when using `wt setup`:

1. **Cursor's format**: `.cursor/worktrees.json` in the repository root
2. **Generic format**: `worktrees.json` in the repository root

The tool checks for `.cursor/worktrees.json` first, then falls back to `worktrees.json`.

**Note:** Setup scripts only run when using the `wt setup` command. The `wt new` command will not execute setup scripts.

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

#### Security Features

- **Command Blocklist**: Dangerous command patterns are automatically blocked
- **Blocked Patterns**: 
  - `rm -rf` and recursive deletions
  - `sudo` and privilege escalation commands
  - `chmod`, `chown` permission changes
  - Piping downloads to shell (`curl | sh`, `wget | sh`)
  - Disk operations (`dd`, `mkfs`, `format`)
  - System commands (`shutdown`, `reboot`, `kill -9`)
  - Fork bombs and malicious patterns
- **Flexible Execution**: Any command not matching dangerous patterns is allowed, giving you full flexibility for legitimate setup tasks

#### Execution Details

- Commands are executed in the new worktree directory
- The `$ROOT_WORKTREE_PATH` environment variable is available, pointing to the main repository root
- Commands run with shell execution, so complex commands and piping are supported
- If a command fails, the error is logged, but setup continues with the next command
- The setup runs after worktree creation but before dependency installation (if `--install` is used)

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
- An editor installed and available in PATH (defaults to Cursor, can be set to `none` to skip)
- **For `wt pr` command:** GitHub CLI (`gh`) or GitLab CLI (`glab`) installed and authenticated

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