// Let the browser evaluate selectors, layers, conditions, importance and
// inheritance. Companion properties trace declaration provenance; comparing
// final colors cannot distinguish a variable from an equal literal override.
const registrations=new WeakMap();
const inherited=/^(?:color|font(?:-.+)?|line-height|letter-spacing|word-spacing|text-(?:align|indent|transform|shadow)|white-space|visibility|cursor|direction|list-style(?:-.+)?)$/u;
const shorthands={margin:['margin-top','margin-right','margin-bottom','margin-left'],padding:['padding-top','padding-right','padding-bottom','padding-left'],gap:['row-gap','column-gap'],background:['background-color','background-image','background-position','background-size','background-repeat'],font:['font-size','font-family','font-weight','font-style','line-height'],border:['border-top-color','border-right-color','border-bottom-color','border-left-color','border-top-width','border-right-width','border-bottom-width','border-left-width','border-top-style','border-right-style','border-bottom-style','border-left-style'],animation:['animation-name','animation-duration','animation-timing-function','animation-delay','animation-iteration-count','animation-direction','animation-fill-mode','animation-play-state'],flex:['flex-grow','flex-shrink','flex-basis']};
function declarationsOf(style) {
  // CSSOM expands a var() shorthand into empty pending-substitution longhands.
  // Its canonical serialization retains the actual declaration and its order.
  const text=style.cssText,parts=[];let start=0,depth=0,quote=null;
  for(let i=0;i<=text.length;i++) {
    const char=text[i];
    if(char==='\\'){i++;continue;}
    if(quote){if(char===quote)quote=null;continue;}
    if(char==='"'||char==="'"){quote=char;continue;}
    if(char==='('||char==='[')depth++;if(char===')'||char===']')depth--;
    if(i===text.length||char===';'&&depth===0){parts.push(text.slice(start,i));start=i+1;}
  }
  return parts.flatMap(part=>{const colon=part.indexOf(':');if(colon<0)return [];const property=part.slice(0,colon).trim(),raw=part.slice(colon+1).trim();if(property.startsWith('--foundation-cascade-'))return [];return [{property,value:raw.replace(/\s*!important\s*$/iu,''),priority:/!important\s*$/iu.test(raw)?'important':''}];});
}
function variables(text) {
  const result=[];
  for(let i=0;i<text.length;i++)if(text.slice(i,i+4)==='var(') {
    let depth=1,end=i+4,comma=-1;
    for(;end<text.length&&depth;end++){if(text[end]==='(')depth++;if(text[end]===')')depth--;if(text[end]===','&&depth===1&&comma<0)comma=end;}
    if(depth)break;
    result.push({name:text.slice(i+4,comma<0?end-1:comma).trim(),fallback:comma<0?null:text.slice(comma+1,end-1)});i=end-1;
  }
  return result;
}
export function inspectStyleVariableUsage(element,win) {
  const candidates=[],styles=[],limitations=[],properties=new Set(),propertyRegistrations=new Map(),expansions=new Map();
  const expand=property=>{
    if(!expansions.has(property)) {
      const probe=win.document.createElement('span').style;probe.setProperty(property,'var(--foundation-provenance-probe)');
      expansions.set(property,Array.from(probe).length?Array.from(probe):shorthands[property] || [property]);
    }
    return expansions.get(property);
  };
  const add=(style,selector=null,node=null)=>{
    const declarations=declarationsOf(style);
    for(const declaration of declarations)for(const property of expand(declaration.property))properties.add(property);
    styles.push({style,selector,node,declarations});
    if(!selector||(()=>{try{return element.matches(selector);}catch{return false;}})())for(const declaration of declarations)for(const item of variables(declaration.value))candidates.push({name:item.name,property:declaration.property,selector,state:'declaration-candidate'});
  };
  const walk=rules=>{for(const rule of rules || []){if(rule.type===1){add(rule.style,rule.selectorText);if(rule.cssRules)walk(rule.cssRules);}else if(rule.constructor?.name==='CSSPropertyRule')propertyRegistrations.set(rule.name,{inherits:rule.inherits});else if(rule.cssRules&&rule.type!==7)walk(rule.cssRules);}};
  for(const sheet of win.document.styleSheets)try{walk(sheet.cssRules);}catch{limitations.push('存在无法读取的跨域样式表，使用关系未完整核验');}
  for(let node=element;node;node=node.parentElement)if(node.style?.length)add(node.style,null,node);
  if(!win.CSS?.registerProperty)return {used:[],candidates,limitations:['当前浏览器不支持级联来源追踪；声明候选不算实际使用']};
  if(limitations.length)return {used:[],candidates,limitations};
  let registered=registrations.get(win.document);
  if(!registered){registered=new Map();registrations.set(win.document,registered);}
  for(const property of properties)if(!registered.has(property)) {
    const name='--foundation-cascade-'+win.crypto.randomUUID();
    try{win.CSS.registerProperty({name,syntax:'*',inherits:propertyRegistrations.get(property)?.inherits??(property.startsWith('--')||inherited.test(property)),initialValue:'none'});registered.set(property,name);}catch{return {used:[],candidates,limitations:['无法建立浏览器级联来源追踪']};}
  }
  const restore=[],origins=new Map();let sequence=0;
  try {
    for(const item of styles) {
      const winners=new Map();
      for(const declaration of item.declarations)for(const property of declaration.property==='all'?[...properties].filter(property=>!property.startsWith('--')):expand(declaration.property)) {
        if(winners.get(property)?.priority==='important'&&declaration.priority!=='important')continue;
        winners.set(property,declaration);
      }
      for(const [property,declaration] of winners) {
        const trace=registered.get(property),id='f'+sequence++,value=declaration.value.trim();
        origins.set(id,{...item,...declaration});
        const keyword=['inherit','initial','unset','revert','revert-layer'].includes(value)?value:id;
        restore.push({style:item.style,trace,value:item.style.getPropertyValue(trace),priority:item.style.getPropertyPriority(trace)});
        item.style.setProperty(trace,keyword,declaration.priority);
      }
    }
    const computed=win.getComputedStyle(element),used=new Map(),animated=new Set();
    for(const animation of element.getAnimations?.() || [])if(animation.playState!=='idle')for(const frame of animation.effect?.getKeyframes?.() || [])for(const property of Object.keys(frame).filter(key=>!['offset','computedOffset','easing','composite'].includes(key)))animated.add(property.replace(/[A-Z]/gu,char=>'-'+char.toLowerCase()));
    if(animated.size)limitations.push('动画或过渡控制的属性未归因为静态变量声明：'+[...animated].join(', '));
    const visit=(value,property,seen=new Set())=>{
      for(const variable of variables(value)) {
        if(!/^--[\w-]+$/u.test(variable.name)||seen.has(variable.name))continue;
        const actual=computed.getPropertyValue(variable.name).trim();
        if(!actual){if(variable.fallback!==null)visit(variable.fallback,property,seen);continue;}
        const old=used.get(variable.name);
        used.set(variable.name,{name:variable.name,value:actual,properties:[...new Set([...(old?.properties || []),property])],evidence:'browser-cascade-provenance'});
        const origin=origins.get(computed.getPropertyValue(registered.get(variable.name)).trim());
        if(origin)visit(origin.value,property,new Set([...seen,variable.name]));
      }
    };
    for(const property of properties) {
      if(property.startsWith('--')||animated.has(property))continue;
      const origin=origins.get(computed.getPropertyValue(registered.get(property)).trim());
      if(origin)visit(origin.value,property);
    }
    return {used:[...used.values()],candidates,limitations};
  }finally {
    for(const entry of restore.reverse())if(entry.value)entry.style.setProperty(entry.trace,entry.value,entry.priority);else entry.style.removeProperty(entry.trace);
  }
}
