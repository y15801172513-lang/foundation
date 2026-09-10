export function foundationFontPlatform(navigatorLike = globalThis.navigator) {
  const platform = navigatorLike?.userAgentData?.platform || navigatorLike?.platform || '';
  if (/windows|win32|win64/iu.test(platform)) return 'windows';
  if (/macos|macintosh|macintel/iu.test(platform)) return 'macos';
  return 'other';
}

export function applyFoundationFontPlatform(documentLike = globalThis.document, navigatorLike = globalThis.navigator) {
  const platform = foundationFontPlatform(navigatorLike);
  documentLike.documentElement.dataset.fontPlatform = platform;
  return platform;
}
