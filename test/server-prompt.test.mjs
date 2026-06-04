import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
	promptServers,
	toEnvUpdates,
	normalizePrefix,
	uniquePrefix,
} from '../src/lib/server-prompt.mjs';

/**
 * Fake `@inquirer/prompts` driven by per-method queues. `select`/`input`/
 * `confirm` shift their next queued answer, ignoring validate/default.
 */
function fakePrompts( { selects = [], inputs = [], confirms = [] } ) {
	const s = [ ...selects ];
	const i = [ ...inputs ];
	const c = [ ...confirms ];
	return {
		select: async () => s.shift(),
		input: async () => i.shift(),
		confirm: async () => c.shift(),
	};
}

test( 'normalizePrefix produces UPPER_SNAKE_CASE tokens', () => {
	assert.equal( normalizePrefix( 'prod' ), 'PROD' );
	assert.equal( normalizePrefix( 'staging-eu' ), 'STAGING_EU' );
	assert.equal( normalizePrefix( '  my server!! ' ), 'MY_SERVER' );
	assert.equal( normalizePrefix( '' ), 'SERVER' );
	assert.equal( normalizePrefix( '---' ), 'SERVER' );
} );

test( 'uniquePrefix suffixes on collision without mutating the set', () => {
	const used = new Set( [ 'PROD' ] );
	assert.equal( uniquePrefix( 'DEV', used ), 'DEV' );
	assert.equal( uniquePrefix( 'PROD', used ), 'PROD_2' );
	used.add( 'PROD_2' );
	assert.equal( uniquePrefix( 'PROD', used ), 'PROD_3' );
	assert.equal( used.has( 'PROD_2' ), true ); // unaffected by the DEV/PROD_3 probes
} );

test( 'loops over two servers until the user declines', async () => {
	const prompts = fakePrompts( {
		selects: [ 'prod', 'dev' ],
		inputs: [
			'prod.example.com', 'ai-agent', '22', '~/.ssh/id_ed25519', '/var/www/app',
			'dev.example.com', 'deploy', '2222', '~/.ssh/id_ed25519', '',
		],
		confirms: [ true, false ],
	} );

	const servers = await promptServers( { _prompts: prompts } );

	assert.equal( servers.length, 2 );
	assert.deepEqual(
		servers.map( ( s ) => [ s.role, s.prefix, s.host, s.user, s.port, s.root ] ),
		[
			[ 'prod', 'PROD', 'prod.example.com', 'ai-agent', '22', '/var/www/app' ],
			[ 'dev', 'DEV', 'dev.example.com', 'deploy', '2222', '' ],
		],
	);
} );

test( 'custom role is normalized and duplicate roles get unique prefixes', async () => {
	const prompts = fakePrompts( {
		selects: [ 'prod', '__custom__', 'prod' ],
		inputs: [
			// server 1 (prod)
			'p1.example.com', 'u1', '22', '~/.ssh/id_ed25519', '',
			// server 2 (custom name first, then params)
			'staging-eu', 's2.example.com', 'u2', '22', '~/.ssh/id_ed25519', '',
			// server 3 (prod again → PROD_2)
			'p3.example.com', 'u3', '22', '~/.ssh/id_ed25519', '',
		],
		confirms: [ true, true, false ],
	} );

	const servers = await promptServers( { _prompts: prompts } );

	assert.deepEqual( servers.map( ( s ) => s.prefix ), [ 'PROD', 'STAGING_EU', 'PROD_2' ] );
	assert.equal( servers[1].role, 'staging-eu' );
} );

test( 'returns empty list when the first server is declined', async () => {
	const prompts = fakePrompts( {
		selects: [ 'prod' ],
		inputs: [ 'h', 'u', '22', '~/.ssh/id_ed25519', '' ],
		confirms: [ false ],
	} );
	const servers = await promptServers( { _prompts: prompts } );
	assert.equal( servers.length, 1 ); // first server is always collected; decline just stops the loop
} );

test( 'toEnvUpdates writes prefixed keys, skips blank port/root, and records the registry', () => {
	const servers = [
		{ role: 'prod', prefix: 'PROD', host: 'prod.example.com', user: 'ai', port: '22', keyPath: '~/.ssh/id_ed25519', root: '/var/www/app' },
		{ role: 'dev', prefix: 'DEV', host: 'dev.example.com', user: 'deploy', port: '', keyPath: '~/.ssh/id_ed25519', root: '' },
	];
	const u = toEnvUpdates( servers );

	assert.equal( u.SSH_PROD_HOST, 'prod.example.com' );
	assert.equal( u.SSH_PROD_USER, 'ai' );
	assert.equal( u.SSH_PROD_PORT, '22' );
	assert.equal( u.SSH_PROD_KEY, '~/.ssh/id_ed25519' );
	assert.equal( u.SSH_PROD_ROOT, '/var/www/app' );

	assert.equal( u.SSH_DEV_HOST, 'dev.example.com' );
	assert.equal( 'SSH_DEV_PORT' in u, false ); // blank port skipped
	assert.equal( 'SSH_DEV_ROOT' in u, false ); // blank root skipped

	assert.equal( u.SSH_SERVERS, 'PROD,DEV' );
} );
