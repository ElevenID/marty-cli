#!/usr/bin/env node

/**
 * Marty CLI — command-line client for the Marty Identity Platform.
 *
 * Uses @elevenid/marty-api-core for HTTP communication and
 * local command modules for domain operations.
 */

import { Command } from 'commander';
import { registerAuthCommands } from '../src/commands/auth.js';
import { registerHealthCommand } from '../src/commands/health.js';
import { registerOrgsCommands } from '../src/commands/orgs.js';
import { registerCredentialsCommands } from '../src/commands/credentials.js';
import { registerFlowsCommands } from '../src/commands/flows.js';
import { registerApplicationsCommands } from '../src/commands/applications.js';
import { registerVerifyCommands } from '../src/commands/verify.js';
import { registerTemplatesCommands } from '../src/commands/templates.js';
import { registerConfigCommands } from '../src/commands/config.js';
import { registerTestCommands } from '../src/commands/teste2e.js';
import { registerInitCommand } from '../src/commands/init.js';
import { registerCompletionCommand } from '../src/commands/completion.js';

const program = new Command();

program
  .name('marty')
  .description('Marty Identity Platform CLI')
  .version('0.1.0')
  .option('--global-output <format>', 'Default output format for all commands (table|json|json-compact)');

// Propagate global --global-output to subcommands that don't specify their own
program.hook('preAction', (thisCommand, actionCommand) => {
  const globalOutput = program.opts().globalOutput;
  if (globalOutput && !actionCommand.getOptionValue('output')) {
    actionCommand.setOptionValue('output', globalOutput);
  }
});

// Register command groups
registerAuthCommands(program);
registerHealthCommand(program);
registerOrgsCommands(program);
registerCredentialsCommands(program);
registerApplicationsCommands(program);
registerVerifyCommands(program);
registerFlowsCommands(program);
registerTemplatesCommands(program);
registerConfigCommands(program);
registerTestCommands(program);
registerInitCommand(program);
registerCompletionCommand(program);

program.parse();
