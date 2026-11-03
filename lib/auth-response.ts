export async function readAuthResponse(response:Response):Promise<any>{
 const text=await response.text();
 try{const data=JSON.parse(text);if(data&&typeof data==='object'&&!Array.isArray(data))return data;}catch{}
 if([502,503,504].includes(response.status))throw Error('Сервер временно недоступен или перезапускается. Подождите несколько секунд и повторите вход.');
 throw Error('Не удалось получить ответ сервера. Обновите страницу и повторите вход.');
}
