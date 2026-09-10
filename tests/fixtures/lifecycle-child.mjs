import fs from 'node:fs';
import path from 'node:path';
import {register} from 'node:module';

register(new URL('./test-host-loader.mjs', import.meta.url), {parentURL: import.meta.url});
const [{applyLifecyclePlan}, {configureRuntimeControl}] = await Promise.all([
  import('../../packages/core/transaction-engine.mjs'),
  import('./test-runtime-surface.mjs'),
]);

const [planFile, pauseKind, pauseStage, markerFile, releaseFile] = process.argv.slice(2);
const plan = JSON.parse(fs.readFileSync(path.resolve(planFile), 'utf8'));
const runtimeControl = pauseKind === 'finalizer'
  ? {finalizerPauseAt: pauseStage, markerFile: path.resolve(markerFile), finalizerTimeoutMs: 10 * 60 * 1000}
  : {pauseAt: pauseStage, markerFile: path.resolve(markerFile), ...(releaseFile ? {releaseFile: path.resolve(releaseFile)} : {})};

try {
  configureRuntimeControl(runtimeControl);
  const result = applyLifecyclePlan({plan, now: plan.createdAt + 1});
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify(error?.toJSON ? error.toJSON() : {code: 'CHILD_UNKNOWN', message: error.message})}\n`);
  process.exitCode = 1;
}
