import {readdir, readFile, writeFile, mkdir} from 'node:fs/promises';
import {extname, relative, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

import {FOUNDATION_UI_POLICY} from '../packages/core/ui-policy.mjs';
import {MANAGEMENT_CENTER_UI_PROFILE} from '../apps/management-center/src/foundation-ui-profile.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoots = ['apps/management-center/src', 'examples/foundation-events/src'];
const sourceExtensions = new Set(['.css', '.js', '.jsx', '.mjs', '.ts', '.tsx']);
const uiPrimitiveSegment = '/components/ui/';
const contentRoles = ['PageTitle', 'PanelTitle', 'SectionTitle', 'ImportantText', 'ContentDescription', 'MetadataText', 'CodeText'];

const patterns = {
  rawFontPixels: /font-size\s*:\s*(?:\d*\.)?\d+px/giu,
  rawFontFamily: /font-family\s*:/giu,
  rawFontWeight: /font-weight\s*:/giu,
  rawLineHeight: /line-height\s*:/giu,
  rawLetterSpacing: /letter-spacing\s*:/giu,
  globalTabularNumbers: /\btabular-nums\b|font-variant-numeric\s*:\s*tabular-nums/giu,
  localSpaceTokens: /--space-[\w-]+/gu,
  arbitraryTextClasses: /\b(?:text|leading|tracking|font)-\[[^\]]+\]/gu,
  arbitrarySpacingClasses: /\b(?:p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml|gap|space-[xy])-\[[^\]]+\]/gu,
  rawContentSpacing: /\b(?:margin|padding|gap|row-gap|column-gap)\s*:\s*[^;{}]*\d+(?:\.\d+)?(?:px|rem)\b/giu,
  hardcodedColors: /#[\da-f]{3,8}\b|(?:rgba?|hsla?|oklch|oklab|lab|lch)\([^)]*\)/giu,
  geometryPixels: /\b(?:width|height|min-width|max-width|min-height|max-height|inset|top|right|bottom|left)\s*:\s*[^;{}]*\b\d+(?:\.\d+)?px\b/giu,
};

function normalizeSelector(selector = '') {
  return selector.replace(/\s+/gu, ' ').replace(/\s*([,>])\s*/gu, '$1').trim();
}

const specialist = MANAGEMENT_CENTER_UI_PROFILE.specialistEngines[0];
const specialistSelectors = new Set(specialist.selectors.map(normalizeSelector));
const approvedSelectorExceptions = new Map();
for (const exception of MANAGEMENT_CENTER_UI_PROFILE.approvedExceptions) {
  for (const selector of exception.selectors || []) {
    for (const file of exception.locations) approvedSelectorExceptions.set(`${file}:${normalizeSelector(selector)}`, exception);
  }
}

async function collectFiles(root) {
  const absoluteRoot = resolve(repositoryRoot, root);
  const result = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, {withFileTypes: true})) {
      const absolute = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (sourceExtensions.has(extname(entry.name))) result.push(absolute);
    }
  }
  await visit(absoluteRoot);
  return result.sort();
}

function lineNumberAt(source, index) {
  return source.slice(0, index).split('\n').length;
}

function cssBlocks(source) {
  const blocks = [];
  const expression = /([^{}]+)\{([^{}]*)\}/gu;
  for (const match of source.matchAll(expression)) blocks.push({selector: normalizeSelector(match[1]), body: match[2], start: match.index, end: match.index + match[0].length});
  return blocks;
}

function enclosingBlock(blocks, index) {
  return blocks.find((block) => index >= block.start && index < block.end) || null;
}

function isThemeToken(file, block) {
  return file.endsWith('/styles.css') && Boolean(block) && (block.selector.endsWith(':root') || block.selector === '.dark');
}

function selectorException(file, selector) {
  return approvedSelectorExceptions.get(`${file}:${normalizeSelector(selector)}`) || null;
}

function valueException(file, value) {
  return MANAGEMENT_CENTER_UI_PROFILE.approvedExceptions.find((exception) => {
    if (!exception.values) return false;
    if (exception.locations.includes(file)) return exception.values.includes(value);
    return file === 'apps/management-center/src/foundation-ui-profile.mjs' && exception.values.some((allowed) => value.includes(allowed));
  }) || null;
}

function specialistDeclaration(block) {
  return Boolean(block && specialistSelectors.has(normalizeSelector(block.selector)));
}

function looksSpecialist(block) {
  return Boolean(block && /(?:react-flow__|page-flow-node|page-node-|node-status|page-thumbnail|logic-flow-canvas)/u.test(block.selector));
}

function findingMetadata({file, rule, value, block, registryPrimitive}) {
  if (registryPrimitive) return {classification: 'primitive-internal', scope: 'registry-primitive', approved: true, reason: 'Local shadcn primitive internals own their documented component implementation.'};
  const exception = selectorException(file, block?.selector) || valueException(file, value);
  if (exception) return {classification: 'approved-exception', scope: 'approved-exception', approved: true, exceptionId: exception.id, reason: exception.reason, evidence: exception.evidence};
  if (looksSpecialist(block)) {
    const declared = specialistDeclaration(block);
    return {classification: 'specialist-engine', scope: 'specialist-engine', approved: declared, exceptionId: declared ? specialist.id : undefined, reason: declared ? specialist.reason : 'Specialist-engine selector is not registered in the product profile.', evidence: declared ? specialist.evidence : []};
  }
  if (rule === 'hardcodedColors' && isThemeToken(file, block)) return {classification: 'primitive-internal', scope: 'registry-primitive', approved: true, reason: 'The project shadcn theme token definition is the semantic color authority.'};
  if (rule === 'geometryPixels') {
    const named = /(?:topbar|workspace|canvas|panel|preview|asset-management|logic-flow)/u.test(block?.selector || '');
    return {classification: named ? 'named-geometry' : 'external-layout', scope: 'layout', approved: true, reason: named ? 'Named product/workspace geometry is intentionally outside primitive internals.' : 'External page layout geometry does not override primitive typography or internal spacing.'};
  }
  return {classification: 'product-content', scope: 'product', approved: false, reason: 'Product content must use the Foundation shadcn token and semantic-role contract.'};
}

function pushFinding(findings, source, details) {
  const {index, ...finding} = details;
  findings.push({...finding, line: lineNumberAt(source, index)});
}

function auditCssPrimitiveOverrides({file, source, blocks, findings}) {
  const internalProperties = /(?:^|;)\s*(?:font(?:-size|-family|-weight)?|line-height|letter-spacing|padding(?:-\w+)?|gap)\s*:/iu;
  for (const block of blocks) {
    if (!block.selector.includes('[data-slot=') || !internalProperties.test(block.body)) continue;
    const exception = selectorException(file, block.selector);
    const declaredSpecialist = specialistDeclaration(block);
    pushFinding(findings, source, {
      rule: 'pagePrimitiveOverride', file, index: block.start, value: block.selector, selector: block.selector,
      classification: exception ? 'approved-exception' : declaredSpecialist ? 'specialist-engine' : 'product-content',
      scope: exception ? 'approved-exception' : declaredSpecialist ? 'specialist-engine' : 'product',
      approved: Boolean(exception || declaredSpecialist), exceptionId: exception?.id || (declaredSpecialist ? specialist.id : undefined),
      reason: exception?.reason || (declaredSpecialist ? specialist.reason : 'Page CSS overrides primitive typography or internal spacing without an exact approved exception.'),
      evidence: exception?.evidence || (declaredSpecialist ? specialist.evidence : []),
    });
  }
}

function auditSpecialistRegistration({file, source, blocks, findings}) {
  if (file !== 'apps/management-center/src/styles.css') return;
  for (const block of blocks.filter(looksSpecialist)) {
    const declared = specialistDeclaration(block);
    pushFinding(findings, source, {
      rule: 'specialistBoundary', file, index: block.start, value: block.selector, selector: block.selector,
      classification: 'specialist-engine', scope: 'specialist-engine', approved: declared, exceptionId: declared ? specialist.id : undefined,
      reason: declared ? specialist.reason : 'Specialist-engine selector is not registered in the product profile.', evidence: declared ? specialist.evidence : [],
    });
  }
}

function auditFakePrimitives({file, source, registryPrimitive, findings}) {
  if (registryPrimitive) return;
  const expression = /<(button|input|select|textarea)(?:\s|>)/gu;
  for (const match of source.matchAll(expression)) {
    pushFinding(findings, source, {rule: 'fakePrimitive', file, index: match.index, value: match[0], classification: 'product-content', scope: 'product', approved: false, reason: 'Product UI must compose the installed local shadcn primitive instead of recreating a native control.'});
  }
}

function auditContentRoles({file, source, findings}) {
  if (file.includes(uiPrimitiveSegment)) return;
  const expression = new RegExp(`<(${contentRoles.join('|')})\\b`, 'gu');
  for (const match of source.matchAll(expression)) {
    pushFinding(findings, source, {rule: 'semanticContentRole', file, index: match.index, value: match[1], classification: 'product-content', scope: 'product-content', approved: true, reason: 'Repeated product content uses a Foundation semantic role backed by shadcn/Tailwind tokens.'});
  }
}

export async function auditUiGovernance() {
  const findings = [];
  for (const sourceRoot of sourceRoots) {
    for (const absolute of await collectFiles(sourceRoot)) {
      const file = relative(repositoryRoot, absolute).replaceAll('\\', '/');
      const source = await readFile(absolute, 'utf8');
      const registryPrimitive = file.includes(uiPrimitiveSegment);
      const blocks = extname(file) === '.css' ? cssBlocks(source) : [];
      for (const [rule, expression] of Object.entries(patterns)) {
        expression.lastIndex = 0;
        for (const match of source.matchAll(expression)) {
          const block = enclosingBlock(blocks, match.index);
          pushFinding(findings, source, {rule, file, index: match.index, value: match[0], selector: block?.selector, ...findingMetadata({file, rule, value: match[0], block, registryPrimitive})});
        }
      }
      auditCssPrimitiveOverrides({file, source, blocks, findings});
      auditSpecialistRegistration({file, source, blocks, findings});
      auditFakePrimitives({file, source, registryPrimitive, findings});
      auditContentRoles({file, source, findings});
    }
  }
  const blockingFindings = findings.filter((finding) => !finding.approved);
  const counts = findings.reduce((result, finding) => {
    result[finding.rule] = (result[finding.rule] || 0) + 1;
    result[`${finding.classification}:${finding.rule}`] = (result[`${finding.classification}:${finding.rule}`] || 0) + 1;
    return result;
  }, Object.fromEntries(Object.keys(patterns).map((rule) => [rule, 0])));
  return {generatedAt: new Date().toISOString(), policyVersion: FOUNDATION_UI_POLICY.version, productProfile: MANAGEMENT_CENTER_UI_PROFILE.product, sourceRoots, counts, findings, blockingFindings, ok: blockingFindings.length === 0};
}

async function main() {
  const report = await auditUiGovernance();
  const outputIndex = process.argv.indexOf('--output');
  if (outputIndex >= 0 && process.argv[outputIndex + 1]) {
    const output = resolve(repositoryRoot, process.argv[outputIndex + 1]);
    await mkdir(dirname(output), {recursive: true});
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) await main();
