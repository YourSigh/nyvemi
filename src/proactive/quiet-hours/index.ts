export function isQuietHour(now:number,start:number,end:number):boolean{
 if(start===end)return false;const hour=new Date(now).getHours();return start>end?hour>=start||hour<end:hour>=start&&hour<end;
}
