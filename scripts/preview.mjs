#!/usr/bin/env node
import {createPreviewController, formatPreviewResult} from './preview-control.mjs';

const command = process.argv[2] || 'start';
const controller = createPreviewController();

try {
  if (command === 'start') console.log(formatPreviewResult(await controller.start()));
  else if (command === 'status') console.log(formatPreviewResult(await controller.status()));
  else if (command === 'stop') console.log(formatPreviewResult(await controller.stop()));
  else throw new Error('用法：npm run preview|npm run preview:status|npm run preview:stop');
} catch (error) {
  console.error(`预览操作失败：${error.message}`);
  process.exitCode = 1;
}
