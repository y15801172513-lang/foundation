import fs from 'node:fs';
import path from 'node:path';
import {applyLifecyclePlan} from '../../packages/core/transaction-engine.mjs';

const plan = JSON.parse(fs.readFileSync(path.resolve(process.argv[2]), 'utf8'));
try {
  const result = applyLifecyclePlan({plan, now: plan.createdAt + 1});
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify(error?.toJSON ? error.toJSON() : {code: error.code || 'UNKNOWN', message: error.message})}\n`);
  process.exitCode = 1;
}
