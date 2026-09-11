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
    else if(flag==='--version'||flag==='--destination'){if(!args.length||args[0].startsWith('--'))fail('参数缺值');result[flag.slice(2)]=args.shift();}
    else fail('未知参数；请查看 --help');
  }
  if((result.prepare||result.acquire||result.destination)&&result.inspect||result.prepare&&result.acquire||result.destination&&result.acquire)fail('参数组合不支持');
  if(!result.inspect&&!result.acquire)result.prepare=true;
  if(result.acquire&&!result.version)fail('获取更新材料前须固定版本');
  return result;
}
