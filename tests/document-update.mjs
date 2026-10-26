/** Foundry-style recursive object updates, array replacement and deletion directives. */
export function recursiveUpdate(target,changes){
 for(const [path,value] of Object.entries(changes)){
  const keys=path.split('.');let node=target;
  for(const key of keys.slice(0,-1))node=node[key]??={};
  const key=keys.at(-1);
  if(key.startsWith('-=')){delete node[key.slice(2)];continue;}
  if(value&&Object.getPrototypeOf(value)===Object.prototype){
   if(!node[key]||Object.getPrototypeOf(node[key])!==Object.prototype)node[key]={};
   recursiveUpdate(node[key],value);
  }else node[key]=structuredClone(value);
 }
 return target;
}
