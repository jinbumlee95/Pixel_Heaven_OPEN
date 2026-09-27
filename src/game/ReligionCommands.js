import { faithVocabulary as words, faithVerbText } from '../i18n/religionIntents.js';
export function parseReligionCommand(input) {
  const s=input.replace(/[.!。！]+$/u,'').trim();
  const order=(operation,id)=>({type:'order',name:'religion',operation,...(id?{id}:{})});
  if(words.query.test(s))return {type:'meta',name:'religion'};
  if(words.close.test(s))return {type:'meta',name:'closeReligion'};
  if(words.praise.test(s))return order('praise');
  if(words.offering.test(s))return order('offering');
  if(words.genericAccept.test(s))return order('accept','next');
  if(words.proclamations[s])return order('enact',words.proclamations[s]);
  for(const [dictionary,operations] of [[words.commandments,['enact','revoke']],[words.rites,['rite']],[words.prayers,['accept']]]) {
    for(const [id,aliases] of Object.entries(dictionary))for(const alias of aliases) {
      if(!s.includes(alias))continue;
      const verb=faithVerbText(s.replace(alias,''));
      for(const operation of operations)if(words[operation].test(verb))return order(operation,id);
    }
  }
  return null;
}
