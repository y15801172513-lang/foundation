export async function copyContextPlainText(clipboard, rawText) {
  try {
    if (!clipboard?.writeText) throw new Error('clipboard unavailable');
    await clipboard.writeText(rawText);
    return {ok: true, message: '已复制给 Codex'};
  } catch {
    return {ok: false, message: '复制失败，请选中原始数据后手动复制。'};
  }
}
