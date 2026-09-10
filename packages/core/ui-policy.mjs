export const FOUNDATION_UI_POLICY = Object.freeze({
  schemaVersion: '1.0.0',
  version: '020R1',
  authority: 'foundation-ui-governance',
  newProjects: {mode: 'shadcn-first'},
  existingProjects: {
    mode: 'preserve-and-inventory',
    classifications: ['existing-shadcn', 'mature-non-shadcn', 'unstable-ui', 'specialist-engine'],
  },
  unspecifiedPreset: 'installed-project-preset',
  compositionOrder: ['local-shadcn-components', 'existing-variants', 'documented-custom-ui'],
  pageLayoutBoundary: 'external-layout-only',
  typography: {
    version: '023',
    newProjects: 'cross-platform-font-sans',
    existingProjects: 'preserve-and-inventory',
    authority: 'tailwind-theme-font-sans',
    latinAndDigits: 'Geist Variable',
    simplifiedChinese: {macOS: 'PingFang SC', windows: ['PingFang SC', 'Microsoft YaHei UI', 'Microsoft YaHei']},
    fallback: ['Noto Sans CJK SC', 'system-ui', 'sans-serif'],
    platformOrder: 'runtime-document-marker',
    systemFontsAreLocalReferencesOnly: true,
  },
  customUiRequirements: ['no-suitable-local-primitive-or-variant', 'documented-reason', 'bounded-scope', 'verification-evidence'],
  dependencyUpgradeRequiresExplicitAuthorization: true,
  exceptionRecordFields: ['reason', 'scope', 'locations', 'evidence'],
});

export function foundationUiPolicyRecord(kind = 'existing', classification = null) {
  const isNew = kind === 'new';
  return {
    version: FOUNDATION_UI_POLICY.version,
    governanceMode: isNew ? FOUNDATION_UI_POLICY.newProjects.mode : FOUNDATION_UI_POLICY.existingProjects.mode,
    classification: classification || (isNew ? 'new-shadcn' : 'unstable-ui'),
    authority: FOUNDATION_UI_POLICY.authority,
  };
}
