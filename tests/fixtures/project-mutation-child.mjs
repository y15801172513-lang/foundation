import fs from 'node:fs';
import path from 'node:path';
import {register} from 'node:module';

register(new URL('./test-host-loader.mjs', import.meta.url), {parentURL: import.meta.url});
const [{applyProjectMutationPlan}, {configureRuntimeControl}] = await Promise.all([
  import('../../packages/core/project-authority.mjs'),
  import('./test-runtime-surface.mjs'),
]);

const [planFile, pauseStage, markerFile, releaseFile] = process.argv.slice(2);
const plan = JSON.parse(fs.readFileSync(path.resolve(planFile), 'utf8'));
try {
  configureRuntimeControl({
    pauseAt: pauseStage,
    markerFile: path.resolve(markerFile),
    ...(releaseFile ? {releaseFile: path.resolve(releaseFile)} : {}),
  });
  const result = applyProjectMutationPlan({plan, now: plan.createdAt + 1});
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify(error?.toJSON ? error.toJSON() : {code: error.code || 'UNKNOWN', message: error.message})}\n`);
  process.exitCode = 1;
}
