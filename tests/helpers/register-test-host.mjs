import {register} from 'node:module';
import './health-probe-observer.mjs';

register(new URL('../fixtures/test-host-loader.mjs', import.meta.url), {parentURL: import.meta.url});
