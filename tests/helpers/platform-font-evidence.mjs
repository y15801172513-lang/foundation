function fontIdentity(font) {
  return `${font?.familyName || ''} ${font?.postScriptName || ''}`.toLocaleLowerCase('en-US');
}

function hasGlyphs(font) {
  return Number(font?.glyphCount) > 0;
}

function isPingFang(font) {
  return hasGlyphs(font) && fontIdentity(font).includes('pingfang');
}

function isYaHei(font) {
  const identity = fontIdentity(font).replaceAll(' ', '');
  return hasGlyphs(font) && (identity.includes('microsoftyahei') || identity.includes('msyahei'));
}

function isPackagedGeist(font) {
  return hasGlyphs(font) && Boolean(font?.isCustomFont) && fontIdentity(font).includes('geist');
}

function normalizeFonts(fonts = []) {
  return fonts.filter(hasGlyphs).map((font) => ({
    familyName: font.familyName || '',
    postScriptName: font.postScriptName || '',
    glyphCount: Number(font.glyphCount),
    isCustomFont: Boolean(font.isCustomFont),
    source: font.isCustomFont ? 'packaged' : 'local',
  }));
}

function uniqueFamilies(targets) {
  const families = [];
  for (const target of targets) {
    for (const font of target.fonts) {
      if (!families.includes(font.familyName)) families.push(font.familyName);
    }
  }
  return families;
}

export function evaluateWindowsFontEvidence({probeFonts = [], latinFonts = [], cjkTargets = [], mixedTargets = []}) {
  const normalizedProbe = normalizeFonts(probeFonts);
  const usablePingFang = normalizedProbe.some(isPingFang);
  const usableYaHei = normalizedProbe.some(isYaHei);
  if (!usablePingFang && !usableYaHei) {
    throw new Error(`隔离的 zh-CN 字形探测未命中 PingFang SC 或 Microsoft YaHei：${JSON.stringify(normalizedProbe)}`);
  }

  const selectedBranch = usablePingFang ? 'pingfang' : 'yahei';
  const matchesSelectedCjk = selectedBranch === 'pingfang' ? isPingFang : isYaHei;
  const normalizedLatin = normalizeFonts(latinFonts);
  if (!normalizedLatin.some(isPackagedGeist)) {
    throw new Error(`Latin/数字未命中仓库打包的 Geist：${JSON.stringify(normalizedLatin)}`);
  }

  const normalizedCjkTargets = cjkTargets.map(({target, fonts}) => ({target, fonts: normalizeFonts(fonts)}));
  const normalizedMixedTargets = mixedTargets.map(({target, fonts}) => ({target, fonts: normalizeFonts(fonts)}));
  for (const target of normalizedCjkTargets) {
    if (!target.fonts.some(matchesSelectedCjk)) {
      throw new Error(`${target.target} 未按 ${selectedBranch} 分支命中中文字体：${JSON.stringify(target.fonts)}`);
    }
  }
  for (const target of normalizedMixedTargets) {
    if (!target.fonts.some(isPackagedGeist) || !target.fonts.some(matchesSelectedCjk)) {
      throw new Error(`${target.target} 未同时命中打包 Geist 与 ${selectedBranch} 中文字体：${JSON.stringify(target.fonts)}`);
    }
  }

  return {
    selectedBranch,
    packagedLatin: true,
    probe: {
      method: 'isolated lang=zh-CN node plus CSS.getPlatformFontsForNode glyph inspection',
      usablePingFang,
      usableYaHei,
      fonts: normalizedProbe,
    },
    latinFonts: normalizedLatin,
    cjkTargets: normalizedCjkTargets,
    mixedTargets: normalizedMixedTargets,
    cjkFamilies: uniqueFamilies(normalizedCjkTargets),
  };
}
