export const NODE_STARTUP_ENVIRONMENT_CONTRACT = Object.freeze({
  schemaVersion: '1.0.0',
  sanitized: Object.freeze([
    Object.freeze({name: 'NODE_OPTIONS', reason: 'accepts preload, loader and output-path startup flags before the Foundation entrypoint'}),
    Object.freeze({name: 'NODE_PATH', reason: 'adds caller-selected external module lookup roots'}),
    Object.freeze({name: 'NODE_V8_COVERAGE', reason: 'writes Node-generated coverage files to a caller-selected directory'}),
    Object.freeze({name: 'NODE_REDIRECT_WARNINGS', reason: 'writes warnings to a caller-selected file'}),
    Object.freeze({name: 'NODE_COMPILE_CACHE', reason: 'writes compile-cache files to a caller-selected directory'}),
    Object.freeze({name: 'NODE_COMPILE_CACHE_PORTABLE', reason: 'changes caller-selected compile-cache path handling'}),
    Object.freeze({name: 'NODE_PRESERVE_SYMLINKS', reason: 'changes module identity and resolution through symlink paths'}),
  ]),
  preserved: Object.freeze([
    Object.freeze({names: Object.freeze(['FORCE_COLOR', 'NO_COLOR', 'NODE_DISABLE_COLORS']), reason: 'terminal color and accessibility preferences only'}),
    Object.freeze({names: Object.freeze(['LANG', 'LC_ALL', 'LC_CTYPE', 'TZ']), reason: 'locale and timezone behavior only'}),
    Object.freeze({names: Object.freeze(['NODE_DEBUG', 'NODE_DEBUG_NATIVE', 'NODE_NO_WARNINGS', 'NODE_PENDING_DEPRECATION']), reason: 'stderr diagnostic preferences; no preload, module root or output path'}),
    Object.freeze({names: Object.freeze(['NODE_EXTRA_CA_CERTS', 'NODE_TLS_REJECT_UNAUTHORIZED']), reason: 'network trust inputs are outside this offline startup-injection correction'}),
    Object.freeze({names: Object.freeze(['NODE_REPL_EXTERNAL_MODULE', 'NODE_REPL_HISTORY']), reason: 'the launcher always supplies a fixed script entrypoint and never starts a REPL'}),
    Object.freeze({names: Object.freeze(['NODE_SKIP_PLATFORM_CHECK', 'NODE_PENDING_PIPE_INSTANCES', 'UV_THREADPOOL_SIZE']), reason: 'runtime compatibility or capacity controls; no preload, module root or output path'}),
    Object.freeze({names: Object.freeze(['NODE_ICU_DATA']), reason: 'ICU data lookup only; no executable module or Node-generated output path'}),
    Object.freeze({names: Object.freeze(['NODE_DISABLE_COMPILE_CACHE']), reason: 'can only disable compile-cache writes'}),
  ]),
});

export const NODE_STARTUP_SANITIZED_VARIABLES = Object.freeze(NODE_STARTUP_ENVIRONMENT_CONTRACT.sanitized.map((entry) => entry.name));

export function sanitizeNodeStartupEnvironment(environment = process.env) {
  const sanitized = {...environment};
  for (const name of NODE_STARTUP_SANITIZED_VARIABLES) delete sanitized[name];
  return sanitized;
}

export function posixNodeStartupEnvironmentBoundary() {
  return `unset ${NODE_STARTUP_SANITIZED_VARIABLES.join(' ')}\n`;
}

export function windowsNodeStartupEnvironmentBoundary() {
  return NODE_STARTUP_SANITIZED_VARIABLES.map((name) => `set "${name}="`).join('\r\n');
}
