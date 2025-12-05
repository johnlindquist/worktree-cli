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

### Create a new worktree from Pull Request / Merge Request Number

```bash
wt pr <prNumber> [options]
```
Uses GitHub CLI (`gh`) or GitLab CLI (`glab`) to check out the branch associated with the given Pull Request or Merge Request number, sets it up locally to track the correct remote branch (handling forks automatically), and then creates a worktree for it.

**Benefit:** Commits made in this worktree can be pushed directly using `git push` to update the Pull Request or Merge Request.

**Requires:**
- **For GitHub**: GitHub CLI (`gh`) installed and authenticated
- **For GitLab**: GitLab CLI (`glab`) installed and authenticated

The tool automatically detects whether you're working with a GitHub or GitLab repository by analyzing the remote URL. You can also manually configure the preferred provider (see [Configure Git Provider](#configure-git-provider)).

Options:
- `-p, --path <path>`: Specify a custom path for the worktree (defaults to `<repoName>-<branchName>`)
- `-i, --install <packageManager>`: Package manager to use for installing dependencies (npm, pnpm, bun, etc.)
- `-e, --editor <editor>`: Editor to use for opening the worktree (overrides default editor)

Example:
```bash
# Create worktree for PR/MR #123
wt pr 123

# Create worktree for PR/MR #456, install deps with pnpm, open in vscode
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

### Configure Git Provider

You can configure which Git provider CLI tool to use for the `wt pr` command:

```bash
# Set git provider
wt config set provider <providerName>

# Examples:
wt config set provider gh    # Use GitHub CLI (default)
wt config set provider glab  # Use GitLab CLI

# Get current provider
wt config get provider
```

**Note:** The tool automatically detects your Git provider by analyzing the remote URL (github.com or gitlab.com/gitlab.*). The configuration setting is only used as a fallback or when auto-detection is not possible.

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
- An editor installed and available in PATH (defaults to Cursor)
- **For `wt pr` command:**
  - **GitHub**: GitHub CLI (`gh`) - install with `brew install gh`, authenticate with `gh auth login`
  - **GitLab**: GitLab CLI (`glab`) - install with `brew install glab`, authenticate with `glab auth login`

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