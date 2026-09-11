export const CLI_ROUTE_GROUPS = Object.freeze({
  lifecycleCommands: Object.freeze(['install', 'update', 'repair', 'rollback', 'recover', 'uninstall']),
  lifecycleDispatch: Object.freeze(['install', 'update', 'repair', 'rollback', 'recover', 'uninstall', 'doctor', 'extension']),
  managerCommands: Object.freeze(['inspect', 'request-plan', 'open-manager', 'status']),
  managerForbidden: Object.freeze(['confirm', 'apply', 'recover', 'purge']),
  projectReadCommands: Object.freeze(['inventory', 'status', 'list', 'explain', 'intent']),
  projectPlanCommands: Object.freeze(['enable', 'disable']),
  capabilityReadCommands: Object.freeze(['audit', 'status']),
  capabilityPlanCommands: Object.freeze(['install', 'register', 'activate', 'deactivate', 'uninstall']),
  extensionCommands: Object.freeze(['list', 'detect', 'plan']),
});

const value = (required = false, extra = {}) => ({kind: 'value', required, ...extra});
const flag = (extra = {}) => ({kind: 'flag', ...extra});

const lifecycleOptions = {
  '--root': value(true),
  '--sandbox-root': value(true),
  '--candidate': value(),
  '--target-version': value(),
  '--profile': value(),
  '--ai-bridge': value(),
  '--extension': value(false, {multiple: true}),
  '--format': value(),
  '--mode': value(),
};

const routes = [
  {path: [], options: {}, positionals: {min: 0, max: 0}},
  {path: ['--foundation-health'], options: {}, positionals: {min: 0, max: 0}},
  {path: ['--help'], options: {}, positionals: {min: 0, max: 0}},
  {path: ['workbench', 'open'], options: {'--root': value(true), '--project': value()}, positionals: {min: 0, max: 0}},
  {path: ['install'], options: {'--destination': value(), '--browser': value(), '--choose-destination': flag()}, positionals: {min: 0, max: 0}},
  {path: ['onboarding', 'inspect'], options: {'--destination': value()}, positionals: {min: 0, max: 0}},
  {path: ['onboarding', 'status'], options: {'--session-id': value(true)}, positionals: {min: 0, max: 0}},
  {path: ['onboarding', 'open'], options: {'--root': value(true)}, positionals: {min: 0, max: 0}},
  {path: ['extension'], options: {}, positionals: {min: 0, max: 0}},
];
for (const command of CLI_ROUTE_GROUPS.lifecycleCommands) routes.push({path: [command, 'plan'], options: lifecycleOptions, positionals: {min: 0, max: 0}});
routes.push(
  {path: ['doctor'], options: {'--root': value()}, positionals: {min: 0, max: 0}},
  {path: ['extension', 'list'], options: {}, positionals: {min: 0, max: 0}},
  {path: ['extension', 'detect'], options: {'--adapter': value(true), '--project': value(true)}, positionals: {min: 0, max: 0}},
  {path: ['extension', 'plan'], options: {'--adapter': value(true), '--project': value(true), '--root': value(), '--registry': value()}, positionals: {min: 0, max: 0}},
  {path: ['setup'], options: {}, positionals: {min: 0, max: 0}},
  {path: ['create', 'plan'], options: {'--project': value(true), '--root': value(true), '--format': value()}, positionals: {min: 0, max: 0}},
  {path: ['upgrade', 'plan'], options: {'--project': value(true), '--root': value(true)}, positionals: {min: 0, max: 0}},
  {path: ['manager', 'inspect'], options: {'--root': value(), '--project': value()}, positionals: {min: 0, max: 0}},
  {path: ['manager', 'request-plan'], options: {'--operation': value(true), '--parameters-json': value()}, positionals: {min: 0, max: 0}},
  {path: ['manager', 'open-manager'], options: {'--plan-ref': value(true)}, positionals: {min: 0, max: 0}},
  {path: ['manager', 'status'], options: {'--plan-ref': value(true)}, positionals: {min: 0, max: 0}},
  {path: ['project', 'inventory'], options: {'--project': value(true)}, positionals: {min: 0, max: 0}},
  {path: ['project', 'status'], options: {'--project': value(true), '--root': value()}, positionals: {min: 0, max: 0}},
  {path: ['project', 'list'], options: {'--root': value(true)}, positionals: {min: 0, max: 0}},
  {path: ['project', 'explain'], options: {'--plan': value(true), '--format': value()}, positionals: {min: 0, max: 0}},
  {path: ['project', 'intent'], options: {'--text': value(true), '--project': value(true), '--root': value()}, positionals: {min: 0, max: 0}},
  {path: ['project', 'enable', 'plan'], options: {'--project': value(true), '--root': value(true), '--rebind': flag(), '--format': value()}, positionals: {min: 0, max: 0}},
  {path: ['project', 'disable', 'plan'], options: {'--project': value(true), '--root': value(true), '--rebind': flag(), '--format': value()}, positionals: {min: 0, max: 0}},
  {path: ['project', 'recover', 'plan'], options: {'--root': value(true)}, positionals: {min: 0, max: 0}},
  {path: ['capability', 'audit'], options: {'--manifest': value(true)}, positionals: {min: 0, max: 0}},
  {path: ['capability', 'status'], options: {'--manifest': value(true), '--root': value(true), '--project': value(), '--mutating': flag()}, positionals: {min: 0, max: 0}},
  {path: ['verify'], options: {}, positionals: {min: 1, max: 1}},
  {path: ['status'], options: {'--root': value()}, positionals: {min: 0, max: 1}},
  {path: ['inventory'], options: {}, positionals: {min: 1, max: 1}},
  {path: ['center'], options: {'--port': value(), '--root': value()}, positionals: {min: 1, max: 1}},
  {path: ['classify-change'], options: {'--input': value(true)}, positionals: {min: 0, max: 1}},
);
for (const command of CLI_ROUTE_GROUPS.capabilityPlanCommands) routes.push({path: ['capability', command, 'plan'], options: {'--manifest': value(true), '--root': value(true), '--project': value()}, positionals: {min: 0, max: 0}});

export const FOUNDATION_CLI_COMMAND_CONTRACT = Object.freeze(routes.map((route) => Object.freeze({...route, path: Object.freeze(route.path), options: Object.freeze(route.options), positionals: Object.freeze(route.positionals)})));

export function tokenizeCliExample(command) {
  if (typeof command !== 'string') throw new Error('命令必须是字符串');
  const tokens = []; let token = '', quote = null, active = false;
  for (let i = 0; i < command.length; i += 1) {
    const char = command[i];
    if (char === '\\' && quote !== "'") {
      if (++i === command.length) throw new Error('命令转义未结束');
      token += command[i]; active = true;
    } else if (quote) {
      if (char === quote) quote = null; else token += char;
    } else if (char === '"' || char === "'") { quote = char; active = true; }
    else if (/\s/u.test(char)) { if (active) tokens.push(token); token = ''; active = false; }
    else { token += char; active = true; }
  }
  if (quote) throw new Error('命令引号未闭合');
  if (active) tokens.push(token);
  return tokens;
}

function routeFor(tokens) {
  return FOUNDATION_CLI_COMMAND_CONTRACT
    .filter((route) => (route.path.length > 0 || tokens.length === 0) && route.path.every((part, index) => tokens[index] === part))
    .sort((left, right) => right.path.length - left.path.length)[0] || null;
}

const ENUMS = {
  '--browser': ['system', 'codex'],
  '--format': ['text', 'json'], '--profile': ['core', 'recommended', 'custom'],
  '--ai-bridge': ['on', 'off'], '--mode': ['app-only', 'app-and-runtime', 'full'],
  '--adapter': ['shadcn', 'ant'], '--extension': ['shadcn', 'ant'],
  '--operation': [...CLI_ROUTE_GROUPS.lifecycleCommands, 'enable', 'disable', 'project-layout-migrate', 'project-data-purge', 'normal-uninstall-project-detach', 'offer-preference-update', 'project-authority-recover', 'project-mutation-recover', 'project-mutation', 'capability-recover', ...CLI_ROUTE_GROUPS.capabilityPlanCommands.map((name) => `capability-${name}`)],
};

function invalid(reason) {
  throw Object.assign(new Error(`CLI 参数非法：${reason}；apply 普通 CLI 入口已关闭，请使用 manager open-manager；manager 只支持 inspect|request-plan|open-manager|status；create 必须使用 create plan 或 create apply（apply 已关闭）`), {code: 'CLI_INVOCATION_INVALID'});
}

// The sole runtime parser. Documentation only tokenizes shell examples before calling it.
export function parseCliInvocation(tokens) {
  if (!Array.isArray(tokens) || tokens.some((token) => typeof token !== 'string' || token.includes('\0'))) invalid('参数必须是无 NUL 的字符串数组');
  const route = routeFor(tokens);
  if (!route) invalid('command/subcommand/phase 不存在');
  const remainder = tokens.slice(route.path.length);
  const positionals = [];
  const seen = new Map();
  const parsedOptions = Object.create(null);
  for (let index = 0; index < remainder.length; index += 1) {
    const token = remainder[index];
    if (!token.startsWith('-')) { positionals.push(token); continue; }
    const specification = route.options[token];
    if (!specification) invalid(`forbidden or unknown option: ${token}`);
    const count = (seen.get(token) || 0) + 1;
    if (count > 1 && !specification.multiple) invalid(`option repeated: ${token}`);
    seen.set(token, count);
    if (specification.kind === 'value') {
      const next = remainder[index + 1];
      if (!next || next.startsWith('-')) invalid(`option requires a value: ${token}`);
      if (ENUMS[token] && !ENUMS[token].includes(next)) invalid(`${token} 值不支持：${next}`);
      if (token === '--port' && (!/^\d+$/u.test(next) || Number(next) < 1 || Number(next) > 65535)) invalid('--port 必须是 1..65535 整数');
      if (token === '--target-version' && !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(next)) invalid('--target-version 必须是版本号');
      if (token === '--parameters-json') {
        let object; try { object = JSON.parse(next); } catch { invalid('--parameters-json 无法解析'); }
        if (!object || Array.isArray(object) || typeof object !== 'object') invalid('--parameters-json 必须是 object');
      }
      if (specification.multiple) {
        parsedOptions[token] ||= [];
        if (parsedOptions[token].includes(next)) invalid(`${token} 值重复`);
        parsedOptions[token].push(next);
      } else parsedOptions[token] = next;
      index += 1;
    } else parsedOptions[token] = true;
  }
  for (const [name, specification] of Object.entries(route.options)) if (specification.required && !seen.has(name)) invalid(`missing required option: ${name}${name === '--root' ? '（安装根）' : ''}`);
  if (positionals.length < route.positionals.min || positionals.length > route.positionals.max || positionals.some((p) => !p)) invalid('unexpected/missing positional argument');
  if (parsedOptions['--profile'] === 'custom' && !seen.has('--ai-bridge')) invalid('custom 必须明确选择 --ai-bridge on|off');
  if (seen.has('--choose-destination') && seen.has('--destination')) invalid('页面选择与预选目录不可同时提供');
  if (route.path[1] === 'plan' && CLI_ROUTE_GROUPS.lifecycleCommands.includes(route.path[0])) {
    if (route.path[0] === 'uninstall' && !seen.has('--mode')) invalid('uninstall 必须指定 --mode');
    if (route.path[0] !== 'uninstall' && seen.has('--mode')) invalid('--mode 仅适用于 uninstall');
  }
  if (route.path[0] === 'status' && positionals.length && seen.has('--root')) invalid('status 的 project 与 --root 互斥');
  const argv = [...route.path, ...positionals];
  for (const [name, entry] of Object.entries(parsedOptions)) for (const item of Array.isArray(entry) ? entry : [entry]) argv.push(name, ...(item === true ? [] : [item]));
  for (const entry of Object.values(parsedOptions)) if (Array.isArray(entry)) Object.freeze(entry);
  return Object.freeze({route: route.path, options: Object.freeze(parsedOptions), positionals: Object.freeze(positionals), argv: Object.freeze(argv)});
}

export function validateCliInvocationShape(commandOrTokens) {
  try {
    const raw = Array.isArray(commandOrTokens) ? commandOrTokens : tokenizeCliExample(commandOrTokens);
    const invocation = parseCliInvocation(raw[0] === './foundation-kit' ? raw.slice(1) : raw);
    return {ok: true, route: invocation.route, options: Object.keys(invocation.options).sort(), positionals: invocation.positionals};
  } catch (error) { return {ok: false, reason: error.message}; }
}
