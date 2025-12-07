import { execa } from "execa";
import chalk from "chalk";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { getDefaultEditor, shouldSkipEditor } from "../config.js";

export async function openWorktreeHandler(
  pathOrBranch: string = "",
  options: { editor?: string }
) {
  try {
    // 1. Validate we're in a git repo
    await execa("git", ["rev-parse", "--is-inside-work-tree"]);

    if (!pathOrBranch) {
      console.error(
        chalk.red("You must specify a path or branch name for the worktree.")
      );
      process.exit(1);
    }

    // If the user gave us a path, we can open directly.
    // If user gave us a branch name, we parse `git worktree list` to find the matching path.
    let targetPath = pathOrBranch;

    // Try to see if it's a valid path
    let isDirectory = false;
    try {
      const stats = await stat(pathOrBranch);
      isDirectory = stats.isDirectory();
    } catch {
      isDirectory = false;
    }

    if (!isDirectory) {
      // If it's not a directory, assume it's a branch name:
      const { stdout } = await execa("git", [
        "worktree",
        "list",
        "--porcelain",
      ]);
      // The --porcelain output is structured. We'll parse lines and find the "worktree <path>" and "branch refs/heads/<branchName>"
      const entries = stdout.split("\n");
      let currentPath: string | null = null;
      let foundPath = false;
      for (const line of entries) {
        if (line.startsWith("worktree ")) {
          currentPath = line.replace("worktree ", "").trim();
        } else if (line.startsWith("branch ")) {
          const fullBranchRef = line.replace("branch ", "").trim(); // e.g. refs/heads/my-branch
          const shortBranch = fullBranchRef.replace("refs/heads/", "");
          if (shortBranch === pathOrBranch && currentPath) {
            targetPath = currentPath;
            foundPath = true;
            break;
          }
        }
      }

      if (!foundPath) {
        console.error(
          chalk.red(`Could not find a worktree for branch "${pathOrBranch}".`)
        );
        process.exit(1);
      }
    }

    // Verify the target path exists and is a git worktree
    try {
      await stat(targetPath);
      await stat(resolve(targetPath, ".git")); // Check if it's a git worktree
    } catch (error) {
      console.error(
        chalk.red(
          `The path "${targetPath}" does not exist or is not a git worktree.`
        )
      );
      process.exit(1);
    }

    // Open in the specified editor (or use configured default)
    const configuredEditor = getDefaultEditor();
    const editorCommand = options.editor || configuredEditor;

    if (shouldSkipEditor(editorCommand)) {
      console.log(chalk.gray(`Editor set to 'none', skipping editor open.`));
      console.log(chalk.green(`Worktree path: ${targetPath}`));
    } else {
      console.log(chalk.blue(`Opening ${targetPath} in ${editorCommand}...`));

      try {
        await execa(editorCommand, [targetPath], { stdio: "inherit" });
        console.log(
          chalk.green(`Successfully opened worktree in ${editorCommand}.`)
        );
      } catch (editorError) {
        console.error(
          chalk.red(
            `Failed to open editor "${editorCommand}". Please ensure it's installed and in your PATH.`
          )
        );
        process.exit(1);
      }
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error(chalk.red("Failed to open worktree:"), error.message);
    } else {
      console.error(chalk.red("Failed to open worktree:"), error);
    }
    process.exit(1);
  }
}
