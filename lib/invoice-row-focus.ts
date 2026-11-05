/** Locate a document row without changing its contents or active sort order. */
export function invoiceRowPage(rows:ReadonlyArray<{id:string}>,rowId:string|undefined,size:number){
 if(rowId===undefined||size<1)return null;
 const index=rows.findIndex(row=>row.id===rowId);
 return index<0?null:Math.floor(index/size);
}
