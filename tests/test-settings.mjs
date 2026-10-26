/** A persistent world-settings fixture; each instance represents one world. */
export function mockSettings(initial={}){
 const values=new Map(Object.entries(initial));
 return {values,get:(_id,key)=>values.get(key),async set(_id,key,value){values.set(key,structuredClone(value));return value;}};
}
