#!/usr/bin/env node
import { Command } from "commander";
import { newWorktreeHandler } from "./commands/new.js";
import { listWorktreesHandler } from "./commands/list.js";
import { removeWorktreeHandler } from "./commands/remove.js";
const program = new Command();
program
    .name("cwt")
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
    .command("list")
    .description("List all existing worktrees for this repository.")
    .action(listWorktreesHandler);
program
    .command("remove")
    .argument("[pathOrBranch]", "Path of the worktree or branch to remove.")
    .description("Remove a specified worktree. Cleans up the .git/worktrees references.")
    .action(removeWorktreeHandler);
program.parse(process.argv);
