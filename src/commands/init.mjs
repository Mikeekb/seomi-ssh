/**
 * `seomi-ssh init` — interactive setup orchestrator.
 *
 * Thin command: it sequences lib utilities and owns no business logic itself.
 * Flow:
 *   1. promptServers()            — interactive loop (1..N servers)
 *   2. ensureSshKey() per server  — keygen → copy → verify → manual hint
 *   3. mergeEnv()                 — write SSH_<PREFIX>_* + SSH_SERVERS to .claude/.env
 *   4. detectAgentMdTargets()     — pick AGENTS.md / CLAUDE.md / both
 *   5. renderAgentMdBlock() + insertOrUpdate() — managed block per target
 *   6. copy skills/aif-ssh        — drop the access skill into .claude/skills/
 *
 * `--dry-run` runs the prompts but performs NO side effects (no ssh, no file
 * writes); it prints what would happen and the rendered block instead.
 */

import { mkdir, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../lib/logger.mjs';
import { promptServers, toEnvUpdates } from '../lib/server-prompt.mjs';
import { mergeEnv } from '../lib/env-writer.mjs';
import { ensureSshKey } from '../lib/ssh-key-setup.mjs';
import { detectAgentMdTargets, ensureClaudeImportStub, isClaudeImportStub } from '../lib/agent-md-target.mjs';
import { renderAgentMdBlock } from '../lib/agent-md-renderer.mjs';
import { insertOrUpdate } from '../lib/markers.mjs';

const MARKER_NS = 'seomi-ssh';

function packagePath( ...segments ) {
	// init.mjs lives at <pkg>/src/commands/ — climb two levels to the package root.
	return fileURLToPath( new URL( join( '../../', ...segments ), import.meta.url ) );
}

async function copySkill( cwd ) {
	const src = packagePath( 'skills', 'aif-ssh', 'SKILL.md' );
	const destDir = join( cwd, '.claude', 'skills', 'aif-ssh' );
	await mkdir( destDir, { recursive: true } );
	const dest = join( destDir, 'SKILL.md' );
	await copyFile( src, dest );
	logger.success( `skill aif-ssh → ${ dest }` );
}

function printSummary( servers, dryRun ) {
	logger.info( `Серверов настроено: ${ servers.length }${ dryRun ? ' (dry-run, без записи)' : '' }` );
	for ( const s of servers ) {
		logger.info( `  • ${ s.role } → ${ s.user }@${ s.host }${ s.port && s.port !== '22' ? `:${ s.port }` : '' } (env SSH_${ s.prefix }_*)` );
	}
}

/**
 * @param {object}   [options]
 * @param {string}   [options.cwd]            — project root (default process.cwd()).
 * @param {boolean}  [options['dry-run']]     — no side effects, just preview.
 * @param {string}   [options.envPath]        — override .claude/.env location.
 * @param {string}   [options.templatePath]   — override bundled template path.
 * @param {object}   [options._prompts]       — test seam for @inquirer/prompts.
 * @param {Function} [options._promptSelect]  — test seam for agent-md-target select.
 * @returns {Promise<number>} process exit code.
 */
export async function initCommand( options = {} ) {
	const cwd = options.cwd || process.cwd();
	const dryRun = Boolean( options[ 'dry-run' ] || options.dryRun );
	const envPath = options.envPath || join( cwd, '.claude', '.env' );
	const templatePath = options.templatePath || packagePath( 'templates', 'agent-md-block.md' );

	logger.step( 'seomi-ssh init' + ( dryRun ? ' (dry-run)' : '' ) );

	// --- 1. Prompt for servers -------------------------------------------
	logger.step( 'Шаг 1: Опрос серверов' );
	const servers = await promptServers( { _prompts: options._prompts } );
	if ( servers.length === 0 ) {
		logger.warn( 'Серверы не заданы — нечего настраивать. Выход.' );
		return 0;
	}
	logger.success( `Введено серверов: ${ servers.length }` );

	// --- 2. SSH key wizard per server ------------------------------------
	logger.step( 'Шаг 2: Настройка SSH-ключей' );
	for ( const srv of servers ) {
		if ( dryRun ) {
			logger.info( `[dry-run] ensureSshKey для «${ srv.role }» (${ srv.user }@${ srv.host }) пропущен` );
			continue;
		}
		try {
			const result = await ensureSshKey( {
				sshHost: srv.host,
				sshUser: srv.user,
				sshPort: srv.port,
				keyPath: srv.keyPath,
			} );
			if ( result.verified ) {
				logger.success( `«${ srv.role }»: ключ настроен и проверен (${ result.keygenAction }/${ result.copyAction })` );
			} else {
				logger.warn( `«${ srv.role }»: автоматическая настройка не удалась — ручная подсказка:` );
				logger.warn( result.manualHint );
			}
		} catch ( err ) {
			// One server's failure must not abort the rest of the run.
			logger.error( `«${ srv.role }»: ${ err.message }` );
		}
	}

	// --- 3. Write connection params to .claude/.env ----------------------
	logger.step( 'Шаг 3: Запись реквизитов в .claude/.env' );
	const updates = toEnvUpdates( servers );
	if ( dryRun ) {
		logger.info( `[dry-run] mergeEnv пропущен; были бы записаны ключи: ${ Object.keys( updates ).join( ', ' ) }` );
	} else {
		const r = await mergeEnv( envPath, updates );
		logger.success( `.claude/.env: добавлено ${ r.added.length }, обновлено ${ r.updated.length }, без изменений ${ r.unchanged.length }` );
	}

	// --- 4 & 5. Render + write the managed block -------------------------
	logger.step( 'Шаг 4: Инструкции агенту (AGENTS.md / CLAUDE.md)' );
	const block = await renderAgentMdBlock( servers, templatePath );
	if ( dryRun ) {
		const { targets } = await detectAgentMdTargets( { cwd, interactive: false } );
		logger.info( `[dry-run] managed-блок был бы записан в: ${ targets.join( ', ' ) || '(none)' }` );
		const wouldStub = targets.some( ( f ) => f.endsWith( 'AGENTS.md' ) ) && ! existsSync( join( cwd, 'CLAUDE.md' ) );
		if ( wouldStub ) {
			logger.info( '[dry-run] был бы создан CLAUDE.md с импортом @AGENTS.md (Claude Code не читает AGENTS.md)' );
		}
		process.stdout.write( '\n--- managed block preview ---\n' + block + '--- end preview ---\n' );
	} else {
		const { targets } = await detectAgentMdTargets( {
			cwd,
			interactive: true,
			_promptSelect: options._promptSelect,
		} );
		if ( targets.length === 0 ) {
			logger.warn( 'Целевой файл инструкций не выбран — managed-блок не записан.' );
		}
		for ( const file of targets ) {
			const name = file.split( /[\\/]/ ).pop();
			// CLAUDE.md, который лишь импортирует AGENTS.md, — это редирект, а не
			// носитель блока: писать в него блок значит снова продублировать
			// контент. Оставляем его чистым импортом `@AGENTS.md`.
			if ( name === 'CLAUDE.md' && isClaudeImportStub( file ) ) {
				logger.info( `${ name }: оставлен как импорт @AGENTS.md (блок живёт в AGENTS.md)` );
				continue;
			}
			const res = await insertOrUpdate( file, block, { namespace: MARKER_NS } );
			logger.success( `${ res.action }: ${ file }` );
		}
		// Claude Code не читает AGENTS.md — если блок лёг туда и CLAUDE.md нет,
		// создаём однострочный CLAUDE.md с импортом, чтобы Claude Code видел те
		// же инструкции (включая доступы по SSH).
		if ( targets.length > 0 ) {
			const stub = await ensureClaudeImportStub( { cwd } );
			if ( stub.created ) {
				logger.success( 'Создан CLAUDE.md (импорт @AGENTS.md) — Claude Code теперь читает AGENTS.md' );
			}
		}
	}

	// --- 6. Copy the access skill ----------------------------------------
	logger.step( 'Шаг 5: Копирование skill aif-ssh' );
	if ( dryRun ) {
		logger.info( `[dry-run] копирование skills/aif-ssh → ${ join( cwd, '.claude', 'skills', 'aif-ssh', 'SKILL.md' ) } пропущено` );
	} else {
		await copySkill( cwd );
	}

	logger.step( 'Готово' );
	printSummary( servers, dryRun );
	return 0;
}
