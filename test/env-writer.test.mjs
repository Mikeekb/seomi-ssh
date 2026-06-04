import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeEnv, parseEnv, serializeEnv } from '../src/lib/env-writer.mjs';

async function tmp() {
	return mkdtemp( join( tmpdir(), 'seomi-ssh-env-' ) );
}

test( 'creates the file (and parent dir) when missing', async () => {
	const dir = await tmp();
	const envPath = join( dir, '.claude', '.env' );

	const r = await mergeEnv( envPath, { SSH_PROD_HOST: 'prod.example.com' } );

	assert.equal( r.created, true );
	assert.deepEqual( r.added, [ 'SSH_PROD_HOST' ] );
	assert.ok( existsSync( envPath ) );
	const text = await readFile( envPath, 'utf8' );
	assert.match( text, /SSH_PROD_HOST=prod\.example\.com/ );
	await rm( dir, { recursive: true, force: true } );
} );

test( 'preserves unrelated keys and comments when adding a new server', async () => {
	const dir = await tmp();
	const envPath = join( dir, '.env' );
	await writeFile(
		envPath,
		'# existing\nSSH_PROD_HOST=prod.example.com\nOTHER_KEY=keep-me\n',
		'utf8'
	);

	const r = await mergeEnv( envPath, { SSH_DEV_HOST: 'dev.example.com' } );

	assert.equal( r.created, false );
	assert.deepEqual( r.added, [ 'SSH_DEV_HOST' ] );
	const text = await readFile( envPath, 'utf8' );
	assert.match( text, /# existing/ );
	assert.match( text, /SSH_PROD_HOST=prod\.example\.com/ );
	assert.match( text, /OTHER_KEY=keep-me/ );
	assert.match( text, /SSH_DEV_HOST=dev\.example\.com/ );
	await rm( dir, { recursive: true, force: true } );
} );

test( 'updates an existing key in place and reports unchanged ones', async () => {
	const dir = await tmp();
	const envPath = join( dir, '.env' );
	await writeFile( envPath, 'SSH_PROD_HOST=old.example.com\nSSH_PROD_USER=ai\n', 'utf8' );

	const r = await mergeEnv( envPath, {
		SSH_PROD_HOST: 'new.example.com',
		SSH_PROD_USER: 'ai',
	} );

	assert.deepEqual( r.updated, [ 'SSH_PROD_HOST' ] );
	assert.deepEqual( r.unchanged, [ 'SSH_PROD_USER' ] );
	assert.deepEqual( r.added, [] );
	const text = await readFile( envPath, 'utf8' );
	assert.match( text, /SSH_PROD_HOST=new\.example\.com/ );
	assert.doesNotMatch( text, /old\.example\.com/ );
	await rm( dir, { recursive: true, force: true } );
} );

test( 'parse/serialize round-trips kv, comments and blanks', () => {
	const src = '# c\nA=1\n\nB=2';
	const items = parseEnv( src );
	assert.equal( items[0].type, 'comment' );
	assert.equal( items[1].type, 'kv' );
	assert.equal( items[2].type, 'blank' );
	assert.equal( serializeEnv( items ), src );
} );
