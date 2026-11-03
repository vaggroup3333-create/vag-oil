// Reject old demo requests instead of applying their writes to real records.
export function workingModeError(req:Request){
 const modes=new URL(req.url).searchParams.getAll('mode');
 if(modes.some(mode=>mode!=='live'))return Response.json({error:'Демо-режим отключён. Обновите страницу: доступен только рабочий учёт.'},{status:409,headers:{'Cache-Control':'no-store'}});
 return null;
}
