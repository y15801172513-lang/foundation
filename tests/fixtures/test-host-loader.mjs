const TEST_ADAPTER = new URL('./test-protected-host-adapter.mjs', import.meta.url).href;
const TEST_MANAGER = new URL('./test-manager-confirmation.mjs', import.meta.url).href;
const TEST_RUNTIME = new URL('./test-runtime-surface.mjs', import.meta.url).href;
const TEST_BROWSER = new URL('./test-browser-launch.mjs', import.meta.url).href;
const PROTECTED_HOST_SUFFIXES = [
  '/packages/core/protected-host-adapter.mjs',
  '/node_modules/@foundation/core/protected-host-adapter.mjs',
  '/packages/cli/protected-host-adapter.mjs',
  '/node_modules/@foundation/management-center/src/server/protected-host-adapter.mjs',
];
const MANAGER_SUFFIXES = [
  '/packages/core/manager-confirmation.mjs',
  '/node_modules/@foundation/core/manager-confirmation.mjs',
  '/packages/cli/manager-confirmation.mjs',
  '/node_modules/@foundation/management-center/src/server/manager-confirmation.mjs',
];
const RUNTIME_SUFFIXES = [
  '/packages/core/runtime-surface.mjs',
  '/node_modules/@foundation/core/runtime-surface.mjs',
  '/packages/cli/runtime-surface.mjs',
  '/node_modules/@foundation/management-center/src/server/runtime-surface.mjs',
];
const BROWSER_SUFFIXES = [
  '/packages/core/browser-launch.mjs',
  '/packages/cli/browser-launch.mjs',
];

export async function resolve(specifier, context, nextResolve) {
  const result = await nextResolve(specifier, context);
  if (PROTECTED_HOST_SUFFIXES.some((suffix) => result.url.endsWith(suffix))) {
    return {url: TEST_ADAPTER, shortCircuit: true};
  }
  if (MANAGER_SUFFIXES.some((suffix) => result.url.endsWith(suffix))) {
    return {url: TEST_MANAGER, shortCircuit: true};
  }
  if (RUNTIME_SUFFIXES.some((suffix) => result.url.endsWith(suffix))) {
    return {url: TEST_RUNTIME, shortCircuit: true};
  }
  if (BROWSER_SUFFIXES.some((suffix) => result.url.endsWith(suffix))) {
    return {url: TEST_BROWSER, shortCircuit: true};
  }
  return result;
}
