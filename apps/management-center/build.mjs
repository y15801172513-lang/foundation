import {build} from 'vite';
import path from 'node:path';

await build({root: path.resolve(import.meta.dirname)});
console.log('management-center build OK');
