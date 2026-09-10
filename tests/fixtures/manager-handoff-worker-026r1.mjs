import fs from 'node:fs';
import path from 'node:path';

import {createLocalLifecycleManagerServerForPlanRef} from '../../packages/core/lifecycle-manager-host.mjs';
import {readLocalLifecycleOperationStatus, requestLocalLifecyclePlan} from '../../packages/core/lifecycle-manager.mjs';

const [mode, project, planRef, markerFile] = process.argv.slice(2);

try {
  if (mode === 'serve') {
    const requested = requestLocalLifecyclePlan({operation: 'project-layout-migrate', parameters: {project}});
    const server = createLocalLifecycleManagerServerForPlanRef({planRef: requested.planRef});
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    // Publish readiness only after complete JSON is durable. The parent waits
    // for existence; direct write can expose an empty file between open/write.
    if (fs.realpathSync(path.dirname(markerFile)) !== path.dirname(markerFile)) throw new Error('marker parent must be a real directory');
    const temporary = `${markerFile}.${process.pid}.tmp`;
    const descriptor = fs.openSync(temporary, 'wx', 0o600);
    try { fs.writeFileSync(descriptor, `${JSON.stringify({requested, port: server.address().port})}\n`); fs.fsyncSync(descriptor); }
    finally { fs.closeSync(descriptor); }
    fs.linkSync(temporary, markerFile);
    fs.unlinkSync(temporary);
    process.on('SIGTERM', () => server.close(() => process.exit(0)));
    setInterval(() => {}, 60_000);
  } else if (mode === 'status') {
    process.stdout.write(`${JSON.stringify(readLocalLifecycleOperationStatus({planRef}))}\n`);
  } else throw new Error(`unknown mode ${mode}`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({code: error.code || 'HANDOFF_WORKER_FAILED', message: error.message})}\n`);
  process.exitCode = 2;
}
