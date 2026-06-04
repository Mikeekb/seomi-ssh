import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { fileURLToPath } from 'node:url';
import { renderAgentMdBlock, _internals } from '../src/lib/agent-md-renderer.mjs';

const TEMPLATE = fileURLToPath( new URL( '../templates/agent-md-block.md', import.meta.url ) );

const PROD = {
	role: 'prod',
	prefix: 'PROD',
	host: 'prod.example.com',
	user: 'ai-agent',
	port: '22',
	keyPath: '~/.ssh/id_ed25519',
	root: '/var/www/app',
};
const DEV = {
	role: 'dev',
	prefix: 'DEV',
	host: 'dev.example.com',
	user: 'deploy',
	port: '2222',
	keyPath: '~/.ssh/id_ed25519',
	root: '',
};

test( 'renders a table row and ssh/scp/rsync examples per server', async () => {
	const block = await renderAgentMdBlock( [ PROD, DEV ], TEMPLATE );

	// Table rows
	assert.match( block, /\| prod \| `SSH_PROD_\*` \| prod\.example\.com \| ai-agent \| 22 \| `\/var\/www\/app` \|/ );
	assert.match( block, /\| dev \| `SSH_DEV_\*` \| dev\.example\.com \| deploy \| 2222 \| — \|/ );

	// Examples present for both
	assert.match( block, /ssh -i ~\/\.ssh\/id_ed25519 ai-agent@prod\.example\.com/ );
	assert.match( block, /scp -i ~\/\.ssh\/id_ed25519 -r \.\/local-path ai-agent@prod\.example\.com:\/var\/www\/app\// );
	assert.match( block, /rsync -avz -e "ssh -i ~\/\.ssh\/id_ed25519" \.\/local-dir\/ ai-agent@prod\.example\.com:\/var\/www\/app\// );

	// The HTML-comment markers are NOT part of the rendered block (the markers
	// module wraps it). The template may still mention the marker names in prose.
	assert.doesNotMatch( block, /<!-- seomi-ssh:start -->/ );
} );

test( 'adds the port flag only for non-default ports', async () => {
	const block = await renderAgentMdBlock( [ PROD, DEV ], TEMPLATE );

	// prod is on 22 → no -p flag in its ssh example
	assert.match( block, /ssh -i ~\/\.ssh\/id_ed25519 ai-agent@prod\.example\.com/ );
	// dev is on 2222 → -p / -P / -p flags appear
	assert.match( block, /ssh -p 2222 -i ~\/\.ssh\/id_ed25519 deploy@dev\.example\.com/ );
	assert.match( block, /scp -P 2222 -i/ );
	assert.match( block, /rsync -avz -e "ssh -i ~\/\.ssh\/id_ed25519 -p 2222"/ );
} );

test( 'falls back to <remote-path> when root is empty', async () => {
	const block = await renderAgentMdBlock( [ DEV ], TEMPLATE );
	assert.match( block, /deploy@dev\.example\.com:<remote-path>\// );
} );

test( 'effectivePort treats blank and 22 as no explicit flag', () => {
	assert.equal( _internals.effectivePort( '22' ), '' );
	assert.equal( _internals.effectivePort( '' ), '' );
	assert.equal( _internals.effectivePort( '2222' ), '2222' );
} );

test( 'throws when given no servers', async () => {
	await assert.rejects( () => renderAgentMdBlock( [], TEMPLATE ), /at least one server/i );
} );
