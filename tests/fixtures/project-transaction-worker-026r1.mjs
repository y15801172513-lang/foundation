import fs from 'node:fs';
import path from 'node:path';

import {canonicalStringify, sha256} from '../../packages/core/install-contract.mjs';
import {executeProjectTransaction, recoverProjectTransactions} from '../../packages/core/project-transaction.mjs';

const [mode, root, stateRoot, operation, operationId] = process.argv.slice(2);

try {
  if (mode === 'recover') {
    process.stdout.write(`${JSON.stringify(recoverProjectTransactions({stateRoot}))}\n`);
  } else {
    const target = path.join(root, 'target.txt');
    const emptyDirectory = path.join(root, 'empty-before');
    const expectedBeforeState = {target: sha256(fs.readFileSync(target)), emptyDirectory: fs.existsSync(emptyDirectory)};
    const result = executeProjectTransaction({
      operationId,
      operation,
      planHash: sha256(canonicalStringify({operation, operationId, expectedBeforeState})),
      expectedBeforeState,
      stateRoot,
      scopes: [{root, paths: ['target.txt', 'empty-before', 'created-after']}],
      consume: () => ({schemaVersion: 'test-only', receipt: `receipt-${operationId}`}),
      apply: ({checkpoint}) => {
        fs.writeFileSync(target, `after:${operation}\n`);
        fs.chmodSync(target, 0o640);
        fs.rmSync(emptyDirectory, {recursive: true, force: true});
        fs.mkdirSync(path.join(root, 'created-after'), {recursive: true});
        fs.writeFileSync(path.join(root, 'created-after', 'leaf.txt'), 'created\n');
        checkpoint('generic-write');
        const value = {ok: true, status: 'completed', operation};
        if (operation === 'normal-uninstall') checkpoint('lifecycle-complete', {resumeResult: value});
        return value;
      },
      verify: (value) => {
        if (value.operation !== operation || fs.readFileSync(target, 'utf8') !== `after:${operation}\n`) throw new Error('postcondition failed');
        return {targetHash: sha256(fs.readFileSync(target))};
      },
      completion: {testOnly: true},
      recoveryPolicy: operation === 'normal-uninstall' ? {before: 'byte-exact-rollback', resumeAfterCheckpoint: 'lifecycle-complete', neverBroadenPlan: true} : {before: 'byte-exact-rollback'},
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({code: error.code || 'WORKER_FAILED', message: error.message})}\n`);
  process.exitCode = 2;
}
