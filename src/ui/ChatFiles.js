import { decodeWorld, parsePacks } from '../state/Persistence.js';

export class ChatFiles {
  constructor(game){this.game=game;}
  async run(name) {
    const g=this.game,t=k=>g.i18n.t(`cw.${k}`);
    const restore=saved=>{decodeWorld(saved);sessionStorage.setItem('pixelHeaven.load',saved);location.reload();};
    if(name==='save')localStorage.setItem('pixelHeaven.save',g.snapshot());
    else if(name==='load'){
      const saved=localStorage.getItem('pixelHeaven.save');if(!saved)return {ok:false,message:t('missing')};restore(saved);
    }else if(name==='export'){
      const url=URL.createObjectURL(new Blob([g.snapshot()],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='pixel-heaven-save.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }else if(name==='new'){
      // Preserve the current world under a separate slot before resetting.
      localStorage.setItem('pixelHeaven.previous',g.snapshot());location.reload();
    }else if(name==='previous'){
      const saved=localStorage.getItem('pixelHeaven.previous');if(!saved)return {ok:false,message:t('missing')};restore(saved);
    }else if(name==='clearMods')localStorage.setItem('pixelHeaven.packs','[]');
    else if(name==='import'||name==='mod'){
      const input=document.createElement('input');input.type='file';input.accept='.json,application/json';input.hidden=true;document.body.append(input);
      input.addEventListener('cancel',()=>input.remove(),{once:true});
      input.addEventListener('change',async()=>{
        try {
          const file=input.files[0];if(!file)return;
          if(file.size>(name==='mod'?1_000_000:8_000_000))throw Error('file_too_large');
          const text=await file.text();
          if(name==='mod'){const packs=parsePacks(text);localStorage.setItem('pixelHeaven.packs',JSON.stringify(packs));g.chat.setStatus({message:t('modDone')});}
          else {decodeWorld(text);localStorage.setItem('pixelHeaven.previous',g.snapshot());restore(text);}
        }catch(error){g.chat.setStatus({message:g.i18n.t('cw.error',{error:error.message})});}finally{input.remove();}
      },{once:true});
      input.click();return {ok:true,message:t('file')};
    }else return {ok:false,message:t('invalid')};
    return {ok:true,message:t(name==='clearMods'?'modDone':'done')};
  }
}
