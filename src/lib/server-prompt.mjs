/**
 * Interactive server-prompt loop for `seomi-ssh init`.
 *
 * Repeatedly asks the user to describe a server (role + connection params),
 * then asks "add another?" — looping until the user declines. Supports 1..N
 * servers, each addressable by a unique UPPER_SNAKE_CASE env prefix derived
 * from its role (`prod` → `PROD`, `dev` → `DEV`, custom names normalized).
 *
 * Server model (one object per server):
 *   {
 *     role:    string,  // human role label as entered ('prod' / 'dev' / 'staging-eu')
 *     prefix:  string,  // unique UPPER_SNAKE_CASE env prefix ('PROD', 'STAGING_EU', 'PROD_2')
 *     host:    string,
 *     user:    string,
 *     port:    string,  // '' or numeric string; default '22'
 *     keyPath: string,  // private key path, may contain leading '~'
 *     root:    string,  // optional remote working directory ('' when skipped)
 *   }
 *
 * The `@inquirer/prompts` module is loaded lazily and can be replaced through
 * the `_prompts` test seam so the loop is unit-testable without a TTY.
 *
 * No external commands are run here — this module is pure I/O over prompts and
 * has no horizontal lib dependencies (only the shared logger).
 */

import { logger } from './logger.mjs';

const ROLE_PROD = 'prod';
const ROLE_DEV = 'dev';
const ROLE_CUSTOM = '__custom__';

/**
 * Normalize an arbitrary role label into a bare UPPER_SNAKE_CASE token.
 * Non-alphanumeric runs collapse to a single `_`; leading/trailing `_` are
 * trimmed. The result is always usable as the `<PREFIX>` segment of a
 * `SSH_<PREFIX>_HOST` env key (the `SSH_` literal guarantees the full key
 * still starts with a letter even if the prefix begins with a digit).
 *
 * 'prod' → 'PROD', 'staging-eu' → 'STAGING_EU', '  my server!! ' → 'MY_SERVER'.
 * Falls back to 'SERVER' when nothing usable remains.
 */
export function normalizePrefix( role ) {
	const cleaned = String( role || '' )
		.toUpperCase()
		.replace( /[^A-Z0-9]+/g, '_' )
		.replace( /^_+|_+$/g, '' );
	return cleaned || 'SERVER';
}

/**
 * Ensure `base` is unique against `used` (a Set of already-taken prefixes).
 * On collision, append `_2`, `_3`, … until free. Does NOT mutate `used`.
 */
export function uniquePrefix( base, used ) {
	if ( ! used.has( base ) ) return base;
	let n = 2;
	while ( used.has( `${ base }_${ n }` ) ) n++;
	return `${ base }_${ n }`;
}

/**
 * Prompt for a single server's role, returning the human label.
 * `prod` / `dev` are offered directly; anything else is entered free-form.
 */
async function promptRole( prompts ) {
	const choice = await prompts.select( {
		message: 'Роль сервера',
		default: ROLE_PROD,
		choices: [
			{ name: 'prod — продакшн', value: ROLE_PROD },
			{ name: 'dev — разработка', value: ROLE_DEV },
			{ name: 'другое (своё имя)', value: ROLE_CUSTOM },
		],
	} );

	if ( choice !== ROLE_CUSTOM ) return choice;

	const custom = await prompts.input( {
		message: 'Имя роли (например staging, eu-prod)',
		validate: ( v ) => ( String( v || '' ).trim().length > 0 ? true : 'Имя роли не может быть пустым' ),
	} );
	return String( custom ).trim();
}

/**
 * Prompt for one server's connection parameters (role already known).
 */
async function promptServer( prompts, role, prefix ) {
	logger.debug( `[server-prompt] collecting params for role=${ role } prefix=${ prefix }` );

	const host = await prompts.input( {
		message: `[${ role }] Host (домен или IP)`,
		validate: ( v ) => ( String( v || '' ).trim().length > 0 ? true : 'Host обязателен' ),
	} );
	const user = await prompts.input( {
		message: `[${ role }] SSH-пользователь`,
		validate: ( v ) => ( String( v || '' ).trim().length > 0 ? true : 'Пользователь обязателен' ),
	} );
	const port = await prompts.input( {
		message: `[${ role }] SSH-порт`,
		default: '22',
	} );
	const keyPath = await prompts.input( {
		message: `[${ role }] Путь к приватному ключу`,
		default: '~/.ssh/id_ed25519',
	} );
	const root = await prompts.input( {
		message: `[${ role }] Рабочая директория на сервере (необязательно)`,
		default: '',
	} );

	return {
		role,
		prefix,
		host: String( host ).trim(),
		user: String( user ).trim(),
		port: String( port ).trim(),
		keyPath: String( keyPath ).trim(),
		root: String( root ).trim(),
	};
}

/**
 * Run the interactive loop. Returns the collected server list (possibly empty
 * if the user declined the very first server).
 *
 * @param {object}   [opts]
 * @param {object}   [opts._prompts] — test seam: replaces `@inquirer/prompts`.
 *                                      Must expose `select`, `input`, `confirm`.
 * @returns {Promise<Array<object>>}
 */
export async function promptServers( { _prompts } = {} ) {
	const prompts = _prompts || ( await import( '@inquirer/prompts' ) );
	const servers = [];
	const usedPrefixes = new Set();

	let addMore = true;
	while ( addMore ) {
		const role = await promptRole( prompts );
		const prefix = uniquePrefix( normalizePrefix( role ), usedPrefixes );
		usedPrefixes.add( prefix );

		const server = await promptServer( prompts, role, prefix );
		servers.push( server );
		logger.success( `[server-prompt] добавлен сервер «${ role }» → env-префикс SSH_${ prefix }_*` );

		addMore = await prompts.confirm( {
			message: 'Добавить ещё один сервер?',
			default: false,
		} );
	}

	logger.debug( `[server-prompt] total servers=${ servers.length }` );
	return servers;
}

/**
 * Build the `.claude/.env` updates object for a list of servers.
 * Writes `SSH_<PREFIX>_HOST/USER/PORT/KEY/ROOT` (optional keys skipped when
 * blank) plus the `SSH_SERVERS` registry (csv of prefixes) so `update` can
 * later enumerate every configured server.
 */
export function toEnvUpdates( servers ) {
	const updates = {};
	for ( const s of servers ) {
		const p = s.prefix;
		updates[ `SSH_${ p }_HOST` ] = s.host;
		updates[ `SSH_${ p }_USER` ] = s.user;
		if ( s.port ) updates[ `SSH_${ p }_PORT` ] = s.port;
		updates[ `SSH_${ p }_KEY` ] = s.keyPath;
		if ( s.root ) updates[ `SSH_${ p }_ROOT` ] = s.root;
	}
	updates.SSH_SERVERS = servers.map( ( s ) => s.prefix ).join( ',' );
	return updates;
}
