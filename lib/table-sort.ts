// Compare the displayed report value without changing the data exported to CSV.
function dateValue(value:string){
 const ru=value.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})(?:,?\s+(\d{1,2}):(\d{2}))?$/);
 if(ru)return Date.UTC(+ru[3],+ru[2]-1,+ru[1],+(ru[4]||0),+(ru[5]||0));
 const iso=value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
 return iso?Date.UTC(+iso[1],+iso[2]-1,+iso[3]):null;
}
export function compareReportCells(x:string,y:string){
 const dx=dateValue(x),dy=dateValue(y);
 if(dx!==null&&dy!==null)return dx-dy;
 const numeric=(text:string)=>{const value=text.replace(/[\s\u00a0\u202f]/g,'').replace(/(?:TJS|с|шт\.?|л|%|уп\.)$/i,'').replace(',','.');return /^-?\d+(?:\.\d+)?$/.test(value)?Number(value):null};
 const nx=numeric(x),ny=numeric(y);
 return nx!==null&&ny!==null?nx-ny:x.localeCompare(y,'ru',{numeric:true});
}
