import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { insertOrUpdate, removeBlock, hasBlock } from '../src/lib/markers.mjs';

async function tmp() {
	return mkdtemp( join( tmpdir(), 'seomi-ssh-markers-' ) );
}

test( 'creates the file with a wrapped block when it does not exist', async () => {
	const dir = await tmp();
	const file = join( dir, 'AGENTS.md' );

	const res = await insertOrUpdate( file, 'managed content' );

	assert.equal( res.action, 'created' );
	const text = await readFile( file, 'utf8' );
	assert.match( text, /<!-- seomi-ssh:start -->/ );
	assert.match( text, /managed content/ );
	assert.match( text, /<!-- seomi-ssh:end -->/ );
	assert.equal( await hasBlock( file ), true );
	await rm( dir, { recursive: true, force: true } );
} );

test( 'appends the block to an existing file, preserving prior content', async () => {
	const dir = await tmp();
	const file = join( dir, 'AGENTS.md' );
	await writeFile( file, '# Existing doc\n\nkeep this\n', 'utf8' );

	const res = await insertOrUpdate( file, 'block body' );

	assert.equal( res.action, 'appended' );
	const text = await readFile( file, 'utf8' );
	assert.match( text, /# Existing doc/ );
	assert.match( text, /keep this/ );
	assert.match( text, /block body/ );
	await rm( dir, { recursive: true, force: true } );
} );

test( 'updates the block in place and is idempotent', async () => {
	const dir = await tmp();
	const file = join( dir, 'AGENTS.md' );
	await insertOrUpdate( file, 'v1' );

	const updated = await insertOrUpdate( file, 'v2' );
	assert.equal( updated.action, 'updated' );
	let text = await readFile( file, 'utf8' );
	assert.match( text, /v2/ );
	assert.doesNotMatch( text, /v1/ );

	const again = await insertOrUpdate( file, 'v2' );
	assert.equal( again.action, 'unchanged' );

	// Only one managed span exists (no duplication on re-run).
	const starts = ( text.match( /seomi-ssh:start/g ) || [] ).length;
	assert.equal( starts, 1 );
	await rm( dir, { recursive: true, force: true } );
} );

test( 'removeBlock strips the managed span but keeps surrounding text', async () => {
	const dir = await tmp();
	const file = join( dir, 'AGENTS.md' );
	await writeFile( file, 'before\n', 'utf8' );
	await insertOrUpdate( file, 'body' );

	const res = await removeBlock( file );
	assert.equal( res.action, 'removed' );
	const text = await readFile( file, 'utf8' );
	assert.match( text, /before/ );
	assert.doesNotMatch( text, /seomi-ssh:start/ );
	assert.equal( await hasBlock( file ), false );
	await rm( dir, { recursive: true, force: true } );
} );
