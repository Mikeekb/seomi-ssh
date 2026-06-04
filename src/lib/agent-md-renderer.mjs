/**
 * Render the managed AGENTS.md / CLAUDE.md block from the bundled template.
 *
 * Input is the list of server objects produced by `server-prompt.mjs`
 * (role / prefix / host / user / port / keyPath / root). The block is two
 * generated parts spliced into the template:
 *
 *   {{SERVER_TABLE}}    — one row per server (role, env-prefix, host, user, …)
 *   {{SERVER_EXAMPLES}} — ssh / scp / rsync recipes per server, with the port
 *                         flag and key path pre-filled from the entered values
 *
 * The recipes exist because agents otherwise default to `~/.ssh/config` aliases
 * or GUI deploy clients; pre-cooking concrete `scp`/`rsync` commands keyed off
 * `.claude/.env` keeps them on the canonical channel.
 *
 * Self-contained: only depends on the shared logger. No external commands.
 */

import { readFile } from 'node:fs/promises';
import { logger } from './logger.mjs';

function present( v ) {
	return typeof v === 'string' && v.trim().length > 0;
}

/**
 * A non-default port (anything other than blank/22) needs an explicit flag in
 * the example commands. 22 is the ssh default, so we omit it for cleaner copy.
 */
function effectivePort( port ) {
	return present( port ) && port.trim() !== '22' ? port.trim() : '';
}

function buildServerTable( servers ) {
	const out = [
		'| Роль | env-префикс | Host | User | Port | Рабочая директория |',
		'|------|-------------|------|------|------|--------------------|',
	];
	for ( const s of servers ) {
		out.push(
			`| ${ s.role } | \`SSH_${ s.prefix }_*\` | ${ s.host } | ${ s.user } | ${ present( s.port ) ? s.port : '22' } | ${ present( s.root ) ? `\`${ s.root }\`` : '—' } |`
		);
	}
	return out.join( '\n' );
}

function buildServerExamples( servers ) {
	const blocks = [];
	for ( const s of servers ) {
		const port = effectivePort( s.port );
		const sshPortFlag = port ? `-p ${ port } ` : '';
		const scpPortFlag = port ? `-P ${ port } ` : '';
		const key = present( s.keyPath ) ? s.keyPath : '~/.ssh/id_ed25519';
		const target = `${ s.user }@${ s.host }`;
		const root = present( s.root ) ? s.root : '<remote-path>';
		const rsyncSsh = `-e "ssh -i ${ key }${ port ? ` -p ${ port }` : '' }"`;

		const lines = [];
		lines.push( `#### ${ s.role } — \`${ target }\` (env \`SSH_${ s.prefix }_*\`)` );
		lines.push( '' );
		lines.push( '```bash' );
		lines.push( '# Выполнить команду на сервере' );
		lines.push( `ssh ${ sshPortFlag }-i ${ key } ${ target } "<command>"` );
		lines.push( '' );
		lines.push( '# Скопировать файл/каталог на сервер' );
		lines.push( `scp ${ scpPortFlag }-i ${ key } -r ./local-path ${ target }:${ root }/` );
		lines.push( '' );
		lines.push( '# Инкрементальная синхронизация каталога (рекомендуется для повторных деплоев)' );
		lines.push( `rsync -avz ${ rsyncSsh } ./local-dir/ ${ target }:${ root }/` );
		lines.push( '```' );
		blocks.push( lines.join( '\n' ) );
	}
	return blocks.join( '\n\n' );
}

/**
 * Render the managed block.
 *
 * @param {Array<object>} servers       Server objects from `promptServers`.
 * @param {string}        templatePath  Path to `templates/agent-md-block.md`.
 * @returns {Promise<string>}           The rendered block (no marker comments —
 *                                      `markers.insertOrUpdate` wraps it).
 */
export async function renderAgentMdBlock( servers, templatePath ) {
	if ( ! Array.isArray( servers ) || servers.length === 0 ) {
		throw new Error( 'renderAgentMdBlock: at least one server is required' );
	}
	logger.debug( `[render] rendering block for ${ servers.length } server(s) from ${ templatePath }` );

	const template = await readFile( templatePath, 'utf8' );
	const rendered = template
		.replaceAll( '{{SERVER_TABLE}}', buildServerTable( servers ) )
		.replaceAll( '{{SERVER_EXAMPLES}}', buildServerExamples( servers ) );

	// Collapse runs of 3+ blank lines for stable diffs across re-renders.
	return rendered.replace( /\n{3,}/g, '\n\n' ).trim() + '\n';
}

export const _internals = { buildServerTable, buildServerExamples, effectivePort };
