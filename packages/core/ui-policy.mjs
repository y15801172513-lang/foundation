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

// Pure projection. Its inputs must come from the verified installed rules
// endpoint; historical project.uiPolicy is not current adoption authority.
export function effectiveProjectPolicy({identity, adoption, ruleVersion, programVersion, currentIdentityHash, endpointIdentity, factsReady}) {
  const compatible = adoption && ['preserve', 'react-shadcn'].includes(adoption.technology)
    && adoption.governanceMode === (identity?.projectKind === 'new' && adoption.technology === 'react-shadcn' ? 'shadcn-first' : 'preserve-and-inventory');
  const state = !adoption ? 'not-adopted' : !compatible ? 'incompatible' : !factsReady ? 'preparation-required' : 'ready';
  const mode = compatible ? adoption.governanceMode : 'unconfigured';
  const classification = mode === 'shadcn-first' ? 'new-shadcn' : FOUNDATION_UI_POLICY.existingProjects.classifications.includes(identity?.uiPolicy?.classification) ? identity.uiPolicy.classification : 'unstable-ui';
  return {version: ruleVersion, governanceMode: mode, classification, authority: 'verified-installed-rules-and-project-adoption', state, executable: state === 'ready', programVersion, ruleVersion, adoptedRuleVersion: adoption?.adoptedRuleVersion || null, currentIdentityHash, endpointIdentity, exceptions: structuredClone(adoption?.exceptions || [])};
}

export function projectWithEffectivePolicy(identity, policy) {
  return {...identity, effectivePolicy: policy, uiPolicy: policy, governanceMode: policy.executable ? policy.governanceMode : 'unconfigured', ruleVersion: policy.ruleVersion};
}
