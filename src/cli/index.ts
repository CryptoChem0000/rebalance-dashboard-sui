#!/usr/bin/env node
import { Command } from "commander";

import {
  runCommand,
  withdrawCommand,
  statusCommand,
  reportCommand,
  volumeCommand,
  profitCommand,
  transactionsCommand,
  statsCommand,
} from "./commands";

const program = new Command();

program
  .name("liquidity-manager")
  .description(
    "Automated liquidity management for Osmosis concentrated liquidity pools"
  )
  .version("1.0.0");

// Register all commands
runCommand(program);
withdrawCommand(program);
statusCommand(program);
reportCommand(program);
volumeCommand(program);
profitCommand(program);
transactionsCommand(program);
statsCommand(program);

program.parse();

// Handle no command
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
