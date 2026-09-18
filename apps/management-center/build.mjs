import {build} from 'vite';
import path from 'node:path';

await build({root: path.resolve(import.meta.dirname), configLoader: 'native'});
console.log('management-center build OK');
