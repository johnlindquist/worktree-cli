#!/usr/bin/env node
import { Command } from "commander";
import { newWorktreeHandler } from "./commands/new.js";
import { setupWorktreeHandler } from "./commands/setup.js";
import { listWorktreesHandler } from "./commands/list.js";
import { removeWorktreeHandler } from "./commands/remove.js";
import { mergeWorktreeHandler } from "./commands/merge.js";
import { purgeWorktreesHandler } from "./commands/purge.js";
import { configHandler } from "./commands/config.js";
import { prWorktreeHandler } from "./commands/pr.js";
import { openWorktreeHandler } from "./commands/open.js";
import { extractWorktreeHandler } from "./commands/extract.js";
const program = new Command();
program
    .name("wt")
    .description("Manage git worktrees and open them in the Cursor editor.")
    .version("1.0.0");
program
    .command("new")
    .argument("[branchName]", "Name of the branch to base this worktree on")
    .option("-p, --path <path>", "Relative path/folder name for new worktree")
    .option("-c, --checkout", "Create new branch if it doesn't exist and checkout automatically", false)
    .option("-i, --install <packageManager>", "Package manager to use for installing dependencies (npm, pnpm, bun, etc.)")
    .option("-e, --editor <editor>", "Editor to use for opening the worktree (e.g., code, webstorm, windsurf, etc.)")
    .description("Create a new worktree for the specified branch, install dependencies if specified, and open in editor.")
    .action(newWorktreeHandler);
program
    .command("setup")
    .argument("[branchName]", "Name of the branch to base this worktree on")
    .option("-p, --path <path>", "Relative path/folder name for new worktree")
    .option("-c, --checkout", "Create new branch if it doesn't exist and checkout automatically", false)
    .option("-i, --install <packageManager>", "Package manager to use for installing dependencies (npm, pnpm, bun, etc.)")
    .option("-e, --editor <editor>", "Editor to use for opening the worktree (e.g., code, webstorm, windsurf, etc.)")
    .option("-t, --trust", "Trust and run setup commands without confirmation (for CI environments)", false)
    .description("Create a new worktree and run setup scripts from worktrees.json or .cursor/worktrees.json")
    .action(setupWorktreeHandler);
program
    .command("list")
    .alias("ls")
    .description("List all existing worktrees for this repository.")
    .action(listWorktreesHandler);
program
    .command("remove")
    .alias("rm")
    .argument("[pathOrBranch]", "Path of the worktree or branch to remove.")
    .option("-f, --force", "Force removal of worktree and deletion of the folder", false)
    .description("Remove a specified worktree. Cleans up the .git/worktrees references.")
    .action(removeWorktreeHandler);
program
    .command("merge")
    .argument("<branchName>", "Name of the branch to merge from")
    .option("-f, --force", "Force removal of worktree (when used with --remove)", false)
    .option("--auto-commit", "Automatically commit uncommitted changes in the target worktree", false)
    .option("-m, --message <message>", "Commit message to use when auto-committing (requires --auto-commit)")
    .option("--remove", "Remove the worktree after merging (opt-in destructive cleanup)", false)
    .description("Merge a branch into the current branch. By default, preserves the source worktree after merge.")
    .action(mergeWorktreeHandler);
program
    .command("purge")
    .description("Safely remove all worktrees except for the main branch, with confirmation.")
    .action(purgeWorktreesHandler);
program
    .command("pr")
    .argument("<prNumber>", "GitHub PR or GitLab MR number to create a worktree from")
    .option("-p, --path <path>", "Specify a custom path for the worktree (defaults to repoName-branchName)")
    .option("-i, --install <packageManager>", "Package manager to use for installing dependencies (npm, pnpm, bun, etc.)")
    .option("-e, --editor <editor>", "Editor to use for opening the worktree (overrides default editor)")
    .option("-s, --setup", "Run setup scripts from worktrees.json or .cursor/worktrees.json")
    .option("-t, --trust", "Trust and execute setup scripts without confirmation (use with caution)")
    .description("Fetch the branch for a given GitHub PR or GitLab MR number and create a worktree.")
    .action(prWorktreeHandler);
program
    .command("open")
    .argument("[pathOrBranch]", "Path to worktree or branch name to open")
    .option("-e, --editor <editor>", "Editor to use for opening the worktree (overrides default editor)")
    .description("Open an existing worktree in the editor.")
    .action(openWorktreeHandler);
program
    .command("extract")
    .argument("[branchName]", "Name of the branch to extract (defaults to current branch)")
    .option("-p, --path <path>", "Relative path/folder name for the worktree")
    .option("-i, --install <packageManager>", "Package manager to use for installing dependencies (npm, pnpm, bun, etc.)")
    .option("-e, --editor <editor>", "Editor to use for opening the worktree (overrides default editor)")
    .description("Extract an existing branch as a new worktree. If no branch is specified, extracts the current branch.")
    .action(extractWorktreeHandler);
program
    .command("config")
    .description("Manage CLI configuration settings.")
    .addCommand(new Command("set")
    .description("Set a configuration value.")
    .addCommand(new Command("editor")
    .argument("<editorName>", "Name of the editor command (e.g., code, cursor, webstorm)")
    .description("Set the default editor to open worktrees in.")
    .action((editorName) => configHandler("set", "editor", editorName)))
    .addCommand(new Command("provider")
    .argument("<providerName>", "Name of the git provider CLI (gh for GitHub, glab for GitLab)")
    .description("Set the default git provider for PR/MR commands.")
    .action((providerName) => configHandler("set", "provider", providerName)))
    .addCommand(new Command("worktreepath")
    .argument("<path>", "Path where all worktrees will be created (e.g., ~/worktrees)")
    .description("Set the default directory for new worktrees.")
    .action((worktreePath) => configHandler("set", "worktreepath", worktreePath))))
    .addCommand(new Command("get")
    .description("Get a configuration value.")
    .addCommand(new Command("editor")
    .description("Get the currently configured default editor.")
    .action(() => configHandler("get", "editor")))
    .addCommand(new Command("provider")
    .description("Get the currently configured git provider.")
    .action(() => configHandler("get", "provider")))
    .addCommand(new Command("worktreepath")
    .description("Get the currently configured default worktree directory.")
    .action(() => configHandler("get", "worktreepath"))))
    .addCommand(new Command("clear")
    .description("Clear a configuration value.")
    .addCommand(new Command("worktreepath")
    .description("Clear the default worktree directory (revert to sibling behavior).")
    .action(() => configHandler("clear", "worktreepath"))))
    .addCommand(new Command("path")
    .description("Show the path to the configuration file.")
    .action(() => configHandler("path")));
program.parse(process.argv);
