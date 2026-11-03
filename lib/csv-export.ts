// Keep the original text (including minus signs) while preventing spreadsheet formulas.
export function csvCell(value:unknown):string{
 const text=String(value??'');
 const safe=/^[\s]*[=+@-]/.test(text)||/^[\t\r\n]/.test(text)?"'"+text:text;
 return '"'+safe.replaceAll('"','""')+'"';
}
