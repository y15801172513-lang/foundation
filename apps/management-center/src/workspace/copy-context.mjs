export async function copyContextPlainText(clipboard, rawText) {
  try {
    if (!clipboard?.writeText) throw new Error('clipboard unavailable');
    await clipboard.writeText(rawText);
    return {ok: true, message: '已复制给 Codex'};
  } catch {
    return {ok: false, message: '复制失败，请选中原始数据后手动复制。'};
  }
}

// One outstanding clipboard write per controller; newer selections supersede
// queued work. An older promise can never complete after the newer write.
export function createSelectionCopier(clipboard) {
  let sequence=0,tail=Promise.resolve();
  return content=>{
    const request=++sequence;
    const result=tail.then(()=>request===sequence?copyContextPlainText(clipboard,content):{ok:false,superseded:true});
    tail=result.catch(()=>{});return result;
  };
}
