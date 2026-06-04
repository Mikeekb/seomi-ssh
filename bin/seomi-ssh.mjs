#!/usr/bin/env node
/**
 * seomi-ssh — entry point.
 *
 * Parses argv, sets the log level, and routes to a subcommand. Only `init` is
 * implemented in this release; `update` and `doctor` are declared stubs so the
 * surface is stable and discoverable.
 */

import { parseArgs } from 'node:util';
import { initCommand } from '../src/commands/init.mjs';
import { logger } from '../src/lib/logger.mjs';

const HELP = `Usage: seomi-ssh <command> [options]

Commands:
  init           Interactive setup — configure passwordless SSH access for an
                 AI agent to one or more servers (dev / prod / custom), write
                 the connection params to .claude/.env, render the managed
                 access block into AGENTS.md / CLAUDE.md, and drop the aif-ssh
                 skill into .claude/skills/.
  update         (not implemented yet) Regenerate the managed block from
                 .claude/.env and self-update the package.
  doctor         (not implemented yet) Diagnose configured servers (which are
                 set up, which are reachable by key).

Global options:
  --verbose      Enable debug logging (DEBUG level).
  --dry-run      init only: run prompts but make no changes; preview the block.
  --help, -h     Show this help.
  --version, -v  Print version.
`;

async function readVersion() {
	const { readFile } = await import( 'node:fs/promises' );
	const pkg = JSON.parse(
		await readFile( new URL( '../package.json', import.meta.url ), 'utf8' )
	);
	return pkg.version;
}

async function main() {
	const rawArgs = process.argv.slice( 2 );

	if ( rawArgs.length === 0 || rawArgs[0] === '--help' || rawArgs[0] === '-h' ) {
		process.stdout.write( HELP );
		return 0;
	}

	if ( rawArgs[0] === '--version' || rawArgs[0] === '-v' ) {
		process.stdout.write( ( await readVersion() ) + '\n' );
		return 0;
	}

	const command = rawArgs[0];
	const restArgs = rawArgs.slice( 1 );

	const { values, positionals } = parseArgs( {
		args: restArgs,
		options: {
			verbose: { type: 'boolean', default: false },
			help: { type: 'boolean', short: 'h', default: false },
			'dry-run': { type: 'boolean', default: false },
		},
		strict: false,
		allowPositionals: true,
	} );

	if ( values.verbose ) {
		logger.setLevel( 'debug' );
	}

	const opts = { ...values, positionals };

	switch ( command ) {
		case 'init':
			return await initCommand( opts );
		case 'update':
		case 'doctor':
			logger.warn( `Команда «${ command }» ещё не реализована в этой версии.` );
			logger.info( 'Доступна только `seomi-ssh init`. См. `seomi-ssh --help`.' );
			return 1;
		default:
			logger.error( `Unknown command: ${ command }` );
			process.stdout.write( HELP );
			return 1;
	}
}

main()
	.then( ( code ) => process.exit( code ?? 0 ) )
	.catch( ( err ) => {
		logger.error( 'Unhandled error:', err?.stack || err?.message || String( err ) );
		process.exit( 1 );
	} );
