#!/usr/bin/env node
import { Command } from "commander";
import { newWorktreeHandler } from "./commands/new.js";
import { listWorktreesHandler } from "./commands/list.js";
import { removeWorktreeHandler } from "./commands/remove.js";
import { mergeWorktreeHandler } from "./commands/merge.js";
import { purgeWorktreesHandler } from "./commands/purge.js";
import { configHandler } from "./commands/config.js";
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
    .command("list")
    .description("List all existing worktrees for this repository.")
    .action(listWorktreesHandler);
program
    .command("remove")
    .argument("[pathOrBranch]", "Path of the worktree or branch to remove.")
    .option("-f, --force", "Force removal of worktree and deletion of the folder", false)
    .description("Remove a specified worktree. Cleans up the .git/worktrees references.")
    .action(removeWorktreeHandler);
program
    .command("merge")
    .argument("<branchName>", "Name of the branch to merge from")
    .option("-f, --force", "Force removal of worktree after merge", false)
    .description("Commit changes in the target branch and merge them into the current branch, then remove the branch/worktree")
    .action(mergeWorktreeHandler);
program
    .command("purge")
    .description("Safely remove all worktrees except for the main branch, with confirmation.")
    .action(purgeWorktreesHandler);
program
    .command("config")
    .description("Manage CLI configuration settings.")
    .addCommand(new Command("set")
    .description("Set a configuration value.")
    .addCommand(new Command("editor")
    .argument("<editorName>", "Name of the editor command (e.g., code, cursor, webstorm)")
    .description("Set the default editor to open worktrees in.")
    .action((editorName) => configHandler('set', 'editor', editorName))))
    .addCommand(new Command("get")
    .description("Get a configuration value.")
    .addCommand(new Command("editor")
    .description("Get the currently configured default editor.")
    .action(() => configHandler('get', 'editor'))))
    .addCommand(new Command("path")
    .description("Show the path to the configuration file.")
    .action(() => configHandler('path')));
program.parse(process.argv);
