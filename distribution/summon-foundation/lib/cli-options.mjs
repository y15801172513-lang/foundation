function fail(message){throw Error(message);}
export function parseSummonArgs(args){
  args=[...args];
  if(args.length===0||args.length===1&&['--help','-h'].includes(args[0]))return {help:true};
  if(args.shift()!=='foundation')fail('仅支持 summon foundation');
  const result={prepare:false};const seen=new Set();
  while(args.length){const flag=args.shift();if(seen.has(flag))fail('重复参数');seen.add(flag);
    if(flag==='--prepare')result.prepare=true;
    else if(flag==='--acquire')result.acquire=true;
    else if(flag==='--inspect')result.inspect=true;
    else if(flag==='--update'||flag==='--uninstall')result[flag.slice(2)]=true;
    else if(['--version','--destination','--status','--root','--resume'].includes(flag)){if(!args.length||args[0].startsWith('--'))fail('参数缺值');result[flag.slice(2)]=args.shift();}
    else fail('未知参数；请查看 --help');
  }
  if((result.prepare||result.acquire||result.destination)&&result.inspect||result.prepare&&result.acquire||result.destination&&result.acquire)fail('参数组合不支持');
  if(seen.has('--status')){if(!result.status||seen.size!==1)fail('结果查询需要非空路径且不能与其他操作组合');return result;}
  if(seen.has('--resume')){if(!result.resume||seen.size!==1)fail('恢复需要单一结果路径，不接受新目标或额外操作');return result;}
  if(result.update||result.uninstall){
    if(result.update&&result.uninstall||!result.root||result.inspect||result.acquire||result.prepare||result.destination||result.uninstall&&result.version||result.update&&!result.version)fail('维护需要单一动作、明确 --root；更新还需要固定 --version');
    return result;
  }
  if(result.root)fail('--root 仅用于明确的更新或卸载');
  if(!result.inspect&&!result.acquire)result.prepare=true;
  if(result.acquire&&!result.version)fail('获取更新材料前须固定版本');
  return result;
}
