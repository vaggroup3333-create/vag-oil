import type {PaidStockRow} from './ledger';

export type ExpenseAllocation='value'|'quantity';
const roundMoney=(n:number)=>Math.round((n+Number.EPSILON)*100)/100+0;
export function paidStockExpenseAmount(value:unknown):number{
 if(value===undefined||value==='')return 0;
 if(typeof value!=='string'&&typeof value!=='number')throw Error('Укажите общую сумму расходов');
 const amount=Number(value);
 if(!Number.isFinite(amount)||amount<0||amount>1e9||Math.abs(amount-roundMoney(amount))>1e-8)throw Error('Расход должен быть неотрицательной суммой с точностью до 2 знаков');
 return roundMoney(amount);
}
export function paidStockExpensePlan(rows:PaidStockRow[],value:unknown,method:ExpenseAllocation){
 const expenses=paidStockExpenseAmount(value);
 if(method!=='value'&&method!=='quantity')throw Error('Выберите способ распределения расходов');
 const amounts=rows.map(row=>{
  const qty=row.packaging?Math.round(row.packaging.volume*row.packaging.count*1000)/1000:Number(row.qty);
  const price=row.packaging?Math.round(row.packaging.unitPrice*100)/100/row.packaging.volume:Number(row.cost);
  return {qty,price,base:qty*price};
 });
 if(!amounts.length&&expenses)throw Error('Сначала добавьте товары для распределения расхода');
 if(amounts.some(row=>!Number.isFinite(row.qty)||row.qty<=0||!Number.isFinite(row.price)||row.price<=0||!Number.isFinite(row.base)))throw Error('Для расчёта расходов заполните количество и закупочную цену всех товаров');
 const base=roundMoney(amounts.reduce((n,row)=>n+row.base,0)),total=roundMoney(base+expenses);
 if(!Number.isFinite(total)||total>1e9)throw Error('Проверьте общую стоимость накладной с расходами');
 const weights=amounts.map(row=>method==='quantity'?row.qty:row.base),weight=weights.reduce((a,b)=>a+b,0);
 const cents=Math.round(expenses*100),raw=weights.map(w=>weight?cents*w/weight:0),parts=raw.map(Math.floor);
 // Stable largest-remainder allocation: every cent is assigned exactly once.
 const order=raw.map((n,index)=>({index,remainder:n-parts[index]})).sort((a,b)=>b.remainder-a.remainder||a.index-b.index);
 const left=cents-parts.reduce((a,b)=>a+b,0);
 if(left<0||left>parts.length)throw Error('Не удалось распределить расход. Проверьте суммы товаров');
 for(let i=0;i<left;i++)parts[order[i].index]++;
 const lines=amounts.map((row,i)=>{const expenseAmount=parts[i]/100,expensePerUnit=expenseAmount/row.qty;return {...row,expenseAmount,expensePerUnit,cost:row.price+expensePerUnit,total:roundMoney(row.base+expenseAmount)}});
 return {base,expenses,total,lines};
}
