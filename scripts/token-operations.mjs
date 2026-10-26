const ID='yarpenart-mob-attacker',active=new Set();
const key=doc=>doc.uuid??`${doc.parent?.id}:${doc.id}`;
export const tokenOperationActive=doc=>active.has(key(doc));
/** Old boolean flags cannot prove that an operation is still executing after reload. */
export async function recoverTokenLocks(doc){
 const split=doc.getFlag(ID,'splitLock'),merge=doc.getFlag(ID,'mergeLock');
 if(!split&&!merge)return;
 const scene=doc.parent,others=Array.from(scene?.tokens?.values?.()??[]).filter(token=>token.id!==doc.id);
 const pop=doc.getFlag(ID,'population');
 if(split&&Number(pop?.initial??1)>1&&others.some(token=>token.getFlag(ID,'splitOrigin')?.source===doc.uuid))
  throw Error('A previous split was interrupted with both the original Horde and copies present. Check those tokens before retrying; no creatures were deleted.');
 const origin=doc.getFlag(ID,'mergeOrigin');
 if(merge&&origin?.tokens?.some(token=>token._id!==doc.id&&scene?.tokens?.has(token._id)))
  throw Error('A previous merge was interrupted with source tokens still present. Check the retained Horde and source tokens before retrying; recovery snapshots are preserved.');
 for(const flag of ['splitLock','mergeLock'])if(doc.getFlag(ID,flag))await doc.unsetFlag(ID,flag);
}
/** Synchronous acquisition guards the whole async operation and all selected tokens. */
export async function withTokenOperation(docs,work){
 const keys=[...new Set(docs.map(key))];
 if(keys.some(value=>active.has(value)))throw Error('A selected token is already being split or merged');
 keys.forEach(value=>active.add(value));
 try {for(const doc of docs)await recoverTokenLocks(doc);return await work();}
 finally {keys.forEach(value=>active.delete(value));}
}
