# @johnlindquist/worktree

A CLI tool for managing Git worktrees with a focus on opening them in the Cursor editor.

## Features

- **Interactive TUI**: Fuzzy-searchable selection when arguments are omitted
- **Bare Repository Support**: Works with bare repositories for optimal worktree workflows
- **Atomic Operations**: Automatic rollback on failure for safe worktree creation
- **Stash-aware**: Gracefully handles dirty worktrees with stash/pop workflow
- **PR Integration**: Create worktrees directly from GitHub PRs or GitLab MRs
- **Setup Automation**: Run setup scripts automatically with trust-based security

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

**Dirty Worktree Handling**: If your main worktree has uncommitted changes, you'll be prompted with options:
- **Stash changes**: Automatically stash before creating, restore after
- **Abort**: Cancel the operation
- **Continue anyway**: Proceed with uncommitted changes

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
- `-t, --trust`: Trust and run setup commands without confirmation (for CI environments)

Example:
```bash
wt setup feature/new-feature
wt setup feature/quick-start -i pnpm
wt setup feature/ci-build --trust  # Skip confirmation in CI
```

### Create a new worktree from Pull Request / Merge Request

```bash
wt pr [prNumber] [options]
```

**Interactive Selection**: Run `wt pr` without a number to see a list of open PRs/MRs to choose from.

Uses the GitHub CLI (`gh`) or GitLab CLI (`glab`) to fetch the branch associated with the given Pull Request or Merge Request number directly (without switching your current branch), and creates a worktree for it.

**Benefit:** Your main worktree stays untouched. Commits made in the PR worktree can be pushed directly using `git push` to update the PR/MR.

**Requires GitHub CLI (`gh`) or GitLab CLI (`glab`) to be installed and authenticated.**

The tool automatically detects whether you're working with a GitHub or GitLab repository based on the remote URL.

Options:
- `-p, --path <path>`: Specify a custom path for the worktree (defaults to `<repoName>-<branchName>`)
- `-i, --install <packageManager>`: Package manager to use for installing dependencies (npm, pnpm, bun, etc.)
- `-e, --editor <editor>`: Editor to use for opening the worktree (overrides default editor)
- `-s, --setup`: Run setup scripts from `worktrees.json` or `.cursor/worktrees.json`

Example:
```bash
# Interactive PR selection
wt pr

# Create worktree for GitHub PR #123
wt pr 123

# Create worktree for GitLab MR #456 with deps and editor
wt pr 456 -i pnpm -e code

# Create worktree and run setup scripts
wt pr 123 --setup
```

### Open an existing worktree

```bash
wt open [pathOrBranch]
```

**Interactive Selection**: Run `wt open` without arguments to see a fuzzy-searchable list of worktrees.

Example:
```bash
wt open                    # Interactive selection
wt open feature/login      # Open by branch name
wt open ./path/to/worktree # Open by path
```

### List worktrees

```bash
wt list
```

Shows all worktrees with their status:
- Branch name or detached HEAD state
- Locked/prunable status indicators
- Main worktree marker

### Remove a worktree

```bash
wt remove [pathOrBranch] [options]
```

**Interactive Selection**: Run `wt remove` without arguments to select a worktree to remove.

Options:
- `-f, --force`: Force removal without confirmation

Example:
```bash
wt remove                    # Interactive selection
wt remove feature/login      # Remove by branch name
wt remove ./path/to/worktree # Remove by path
wt remove feature/old -f     # Force remove
```

### Purge multiple worktrees

```bash
wt purge
```

Interactive multi-select interface to remove multiple worktrees at once. The main worktree is excluded from selection.

### Extract current branch to a worktree

```bash
wt extract [branchName] [options]
```

Extracts the current (or specified) branch into a separate worktree, useful when you want to continue working on a branch in isolation.

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
2. `defaultWorktreePath` config setting (with repo namespace)
3. Sibling directory behavior (default fallback)

**Path Collision Prevention:**

When using a global worktree directory, paths are automatically namespaced by repository name to prevent collisions:

Without global path configured (default):
- Current directory: `/Users/me/projects/myrepo`
- Command: `wt new feature/login`
- Creates: `/Users/me/projects/myrepo-feature-login`

With global path configured (`~/worktrees`):
- Current directory: `/Users/me/projects/myrepo`
- Command: `wt new feature/login`
- Creates: `~/worktrees/myrepo/feature-login`

**Branch Name Sanitization:**

Branch names with slashes are converted to dashes for directory names:
- `feature/auth` → `feature-auth`
- `hotfix/urgent-fix` → `hotfix-urgent-fix`

This ensures uniqueness: `feature/auth` and `hotfix/auth` create different directories.

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

#### Security Model

Setup commands use a **trust-based security model**:

- **Default behavior**: Commands are displayed before execution and require confirmation
- **Trust mode**: Use `--trust` flag to skip confirmation (for CI environments)
- **No blocklist**: Unlike regex-based filtering, this model lets you run any legitimate command

```bash
# Interactive confirmation (default)
wt setup feature/new

# Trust mode for CI/scripts
wt setup feature/new --trust
```

#### Execution Details

- Commands are executed in the new worktree directory
- The `$ROOT_WORKTREE_PATH` environment variable is available, pointing to the main repository root
- Commands run with shell execution, so complex commands and piping are supported
- If a command fails, the error is logged, but setup continues with the next command
- The setup runs after worktree creation but before dependency installation (if `--install` is used)

### Bare Repository Support

The CLI fully supports bare repositories, which is the most efficient workflow for heavy worktree users:

```bash
# Clone as bare repository
git clone --bare git@github.com:user/repo.git repo.git

cd repo.git

# Create worktrees for different branches
wt new main -p ../main
wt new feature/auth -p ../auth
wt new hotfix/urgent -p ../urgent
```

Each worktree is a separate working directory, while the bare repo contains only the `.git` data.

## Atomic Operations

All worktree creation operations are atomic with automatic rollback on failure:

1. If worktree creation succeeds but dependency installation fails, the worktree is automatically removed
2. Stashed changes are restored in the finally block, even if an error occurs
3. Failed commands are logged but don't leave the system in an inconsistent state

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

# Run tests
pnpm test

# Run in development mode
pnpm dev
```

## Testing

The project includes comprehensive test coverage:

```bash
# Run all tests
pnpm test

# Run with coverage
pnpm test -- --coverage
```

## License

MIT
