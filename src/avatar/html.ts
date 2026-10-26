export function avatarHTML(
  player: string,
  driver: string,
  wasmBase64: string,
  modelBase64: string,
) {
  if (!/^[A-Za-z0-9+/=]+$/.test(wasmBase64) || !/^[A-Za-z0-9+/=]+$/.test(modelBase64))
    throw new Error('模型数据编码不正确');
  const source = player.replace('export class P2LPlayer', 'class P2LPlayer');
  const safe = (s: string) => s.replace(/<\/script/gi, '<\\/script');
  return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}canvas{display:block;width:100%;height:100%;touch-action:none}</style></head><body><canvas id="stage"></canvas><script>
${safe(source)}
${safe(driver)}
const notify=v=>{if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(JSON.stringify(v));};
window.addEventListener('error',()=>notify({type:'error'}));
window.addEventListener('unhandledrejection',()=>notify({type:'error'}));
const decode=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
(async()=>{try{
 const {instance}=await WebAssembly.instantiate(decode('${wasmBase64}'),{});
 if(instance.exports.p2l_abi_version()>>>16!==1)throw Error('Unsupported runtime ABI');
 const player=await P2LPlayer.fromBytes(document.getElementById('stage'),instance.exports,decode('${modelBase64}'));
 const driver=window.NyvemiAvatarDriver.createDriver(player);driver.setInput({active:false});let stopped=false,previous=performance.now(),frame;
 window.NyvemiAvatar={setInput:v=>driver.setInput(v),dispose:()=>{stopped=true;cancelAnimationFrame(frame);player.dispose();},parameters:driver.parameters};
 const tick=now=>{if(stopped)return;driver.step((now-previous)/1000);previous=now;frame=requestAnimationFrame(tick);};frame=requestAnimationFrame(tick);
 window.addEventListener('pagehide',()=>window.NyvemiAvatar.dispose(),{once:true});
 document.addEventListener('visibilitychange',()=>{previous=performance.now();driver.setInput({active:!document.hidden});});
 notify({type:'ready',parameters:driver.parameters,meshes:player.meshes.length});
}catch(e){notify({type:'error',message:'网格角色加载失败，请检查模型文件'});}})();
</script></body></html>`;
}
