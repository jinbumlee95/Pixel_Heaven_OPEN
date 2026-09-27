export function isCreationOracle(message) {
  return /^(?:빛이\s*있으라|빛이\s*있어라|let\s+there\s+be\s+light|be\s+light(?:\s+made)?|光あれ)[.!。！\s]*$/iu.test(String(message).normalize('NFKC').trim());
}
export async function receiveCreationOracle(i18n) {
  const dialog=document.createElement('dialog');dialog.className='creation-dialog';
  const title=document.createElement('h1'), help=document.createElement('p'), label=document.createElement('label');
  title.textContent='Pixel Heaven';help.textContent=i18n.t('creation.help');label.textContent=i18n.t('creation.label');
  const form=document.createElement('form'), input=document.createElement('input'), reply=document.createElement('p');
  input.id='creation-oracle';label.htmlFor=input.id;input.autocomplete='off';input.maxLength=100;
  input.placeholder=i18n.t('creation.example');input.enterKeyHint='send';reply.setAttribute('role','status');
  form.append(label,input,reply);dialog.append(title,help,form);document.body.append(dialog);dialog.showModal();
  dialog.addEventListener('cancel',event=>event.preventDefault());
  let composing=false,compositionEnter=false;
  input.addEventListener('compositionstart',()=>{composing=true;});
  input.addEventListener('compositionend',()=>{composing=false;});
  input.addEventListener('keydown',event=>{if(event.key==='Enter'&&(composing||event.isComposing||event.keyCode===229))compositionEnter=true;});
  input.addEventListener('keyup',()=>{compositionEnter=false;});
  return new Promise(resolve=>form.addEventListener('submit',event=>{
    event.preventDefault();if(composing||compositionEnter)return;if(!isCreationOracle(input.value)){reply.textContent=i18n.t('creation.unclear');return;}
    dialog.close();dialog.remove();resolve(input.value);
  }));
}
