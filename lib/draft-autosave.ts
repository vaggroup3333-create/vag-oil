// Serialises saves so edits made during a request are saved afterwards.
export class DraftSaveQueue<T>{
 private pending:{signature:string,value:T}|null=null;
 private saved='';private active:Promise<boolean>|null=null;
 constructor(private persist:(value:T)=>Promise<boolean>){}
 update(value:T){const signature=JSON.stringify(value);this.pending={signature,value}}
 get dirty(){return !!this.pending&&this.pending.signature!==this.saved}
 async flush():Promise<boolean>{
  if(this.active){const ok=await this.active;if(!ok)return false;return this.flush()}
  if(!this.dirty)return true;
  const item=this.pending!;
  this.active=(async()=>{try{const ok=await this.persist(item.value);if(ok)this.saved=item.signature;return ok}catch{return false}})();
  const ok=await this.active;this.active=null;
  return ok&&this.dirty?this.flush():ok;
 }
}
