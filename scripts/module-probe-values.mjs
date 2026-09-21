import crypto from 'node:crypto';
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
// Never invoke getters or toJSON. Unsupported prototypes, cycles and descriptor
// failures remain unclassified rather than being advertised as harmless data.
export function inspectModuleExports(namespace) {
  return Object.keys(namespace).sort().map(name=>{
    const functions=[];const active=new Set();
    const encode=(value,location)=>{
      const type=typeof value;
      if(type==='function'){const source=Function.prototype.toString.call(value);functions.push({path:location,name:value.name,source});return ['function',hash(source)];}
      if(type==='undefined')return ['undefined'];
      if(type==='symbol')return ['symbol',Symbol.keyFor(value)??null,value.description??null];
      if(type==='bigint')return ['bigint',String(value)];
      if(type==='number')return ['number',Object.is(value,-0)?'-0':String(value)];
      if(value===null||type!=='object')return [type,value];
      if(active.has(value))throw new Error('循环对象');
      const prototype=Object.getPrototypeOf(value);
      if(![null,Object.prototype,Array.prototype].includes(prototype))throw new Error('未知对象原型');
      active.add(value);const descriptors=Object.getOwnPropertyDescriptors(value);
      const result=['object',Array.isArray(value)?'array':'record',Reflect.ownKeys(descriptors).map(key=>{
        const descriptor=descriptors[key];if(!Object.hasOwn(descriptor,'value'))throw new Error('访问器不可安全分类');
        return [typeof key==='symbol'?['symbol-key',Symbol.keyFor(key)??null,key.description??null]:['string-key',key],encode(descriptor.value,location?location+'.'+String(key):String(key))];
      }).sort((a,b)=>JSON.stringify(a[0]).localeCompare(JSON.stringify(b[0])))];active.delete(value);return result;
    };
    try{const descriptor=Object.getOwnPropertyDescriptor(namespace,name);if(!descriptor||!Object.hasOwn(descriptor,'value'))throw new Error('导出访问器不可安全分类');const value=descriptor.value,encoded=encode(value,'');return {name,type:typeof value,sourceHash:hash(JSON.stringify(encoded)),functions};}
    catch(error){return {name,type:'unknown',unclassified:error.message,functions};}
  });
}
