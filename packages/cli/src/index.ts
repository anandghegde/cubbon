#!/usr/bin/env bun
import { Command } from 'commander';
import { registerCompile } from './commands/compile.ts';
import { registerDoctor } from './commands/doctor.ts';
import { registerInit } from './commands/init.ts';
import { registerScan } from './commands/scan.ts';
import { registerStatus } from './commands/status.ts';

const program = new Command();
program
  .name('cubbon')
  .description('Compiles folders of work documents into a dated, linked Obsidian vault.')
  .version('0.1.0');

registerInit(program);
registerCompile(program);
registerScan(program);
registerStatus(program);
registerDoctor(program);

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
