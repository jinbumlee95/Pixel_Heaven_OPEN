import { dungeonOrder, ROUTES } from './Dungeon.js';
import { parseDungeonCommand } from '../i18n/dungeon.js';
import { dungeonSummary } from '../ui/Dungeon.js';
import { religionSummary } from '../ui/ReligionSummary.js';
import { isQuestion, queryTopic } from '../llm/DialogueAct.js';
import { parseReligionCommand } from './ReligionCommands.js';
import { validReligionOrder, religionOrder, religionConflict } from './Religion.js';
import { parseEquipmentCommand, validEquipmentOrder, executeEquipmentOrder, equipmentSummary } from './EquipmentCommands.js';
import { parseProductionCommand, validProductionOrder, productionSummary } from './ProductionCommands.js';
import { queueProduction, cancelProduction, useProducedGoods } from './Production.js';
import { orderExpedition } from './Expedition.js';
import { JOBS, assignLabor, cancelConstruction, queueConstruction } from './Work.js';
import { GOODS, tradeWithCaravan, hunt, protectHerd } from './LivingWorld.js';
import { respondCounteroffer } from './Diplomacy.js';
import { decisionQueue, selectDecision, setDecision } from './DecisionQueue.js';
import { canSpendFaith, spendFaith, DIVINE_FAITH_COSTS } from './Faith.js';
import { RESOURCE_TYPES, buildingCost } from '../state/economy.js';
import { setStoryProfile } from './Story.js';
import { interpretDivineMessage } from '../llm/divineLLM.js';
import { PREPARATION_SUPPLIES, requestBattleCleanup, smiteRaiders, SMITE_RULES } from './Combat.js';
import { LEGENDS, legendProgress } from './Legends.js';
import { DISASTER_COSTS } from './Disasters.js';
import { parseTradeCommand, validTradeIntent, isTradeMessage } from './TradeCommands.js';
import { tradeBasket, setTradePolicy, quoteTrade, TRADE_VALUES } from './Trading.js';
import { tradeSummary } from '../ui/Merchant.js';

const failure=(code,params={})=>({ok:false,code,messageKey:`cw.${code}`,messageParams:params});
const roleWords={farming:/farming|농부|농사|農民|農業/u,woodcutting:/woodcutting|벌목|伐採/u,mining:/mining|광부|채광|採掘/u,
  crafting:/crafting|제작|製作/u,building:/building|건설공|건축|建築/u,defense:/defense|방위병|수비병|守備/u,husbandry:/husbandry|목축|사육|牧畜/u};
const kinds={raid:/raid|습격|襲撃/u,drought:/drought|가뭄|干ばつ/u,fire:/fire|산불|화재|火災/u,flood:/flood|홍수|洪水/u,cold:/cold|한파|寒波/u,caravan:/caravan|상단|隊商/u,wolves:/wolves|늑대|狼/u,proposal:/proposal|제안|提案/u};
const exact = (text, pattern) => pattern.test(text.replace(/[.!。！?？]+$/u,'').trim());

// Pure intent recognition: returns data only. Unrecognized prose goes to the
// existing divine interpreter; settings never go through a generative model.
export function parseChatCommand(message) {
  if(typeof message!=='string'||!message.trim()||message.length>500)return {type:'invalid'};
  const s=message.normalize('NFKC').trim().toLowerCase();
  if(isQuestion(s))return {type:'meta',name:'question',topic:queryTopic(s)};
  const dungeon=parseDungeonCommand(s);if(dungeon)return dungeon;
  const religious=parseReligionCommand(s);if(religious)return religious;
  const equipment=parseEquipmentCommand(s);if(equipment)return equipment;
  const trade=parseTradeCommand(s);if(trade)return trade;
  const production=parseProductionCommand(s);if(production)return production;
  if (/^(더 깊이 가|영웅 더 깊이 가|go deeper|hero go deeper|もっと深くへ)$/u.test(s)) return {type:'order',name:'expedition',operation:'deeper'};
  if (/^(영웅 보급 보내|원정 보급|resupply hero|send expedition supplies|勇者に補給)$/u.test(s)) return {type:'order',name:'expedition',operation:'supply'};
  const meta=[
    ['help',/^(?:help|도움말|사용법|ヘルプ)$/u],
    ['status',/^(?:status|상태(?: 보여줘)?|状況)$/u],
    ['resources',/^(?:show resources|resources|자원(?: 보여줘| 알려줘| 현황)?|(?:식량|나무|목재|철|철광석|섬유|천)(?:이|가|은|는)? (?:얼마나 (?:남았어|있어)|알려줘|보여줘)|資源(?:を見せて)?)$/u],
    ['labor',/^(?:labor status|노동 현황|일꾼 현황|労働状況)$/u],
    ['work',/^(?:work status|건설 현황|建設状況)$/u],
    ['animals',/^(?:animals|동물 현황|動物状況)$/u],
    ['packs',/^(?:mod list|모드 목록|mod一覧)$/u],
    ['metrics',/^(?:metrics|성능|性能)$/u],
    ['buildings',/^(?:buildings|건물 목록|建物一覧)$/u],
    ['factions',/^(?:factions|세력 목록|勢力一覧)$/u],
    ['events',/^(?:events|사건 목록|事件一覧)$/u],
    ['history',/^(?:history|기록(?: 보여줘)?|記録)$/u],
    ['costs',/^(?:costs|비용(?: 알려줘)?|費用)$/u],
    ['save',/^(?:save(?: world)?|저장(?:해)?|保存)$/u],['load',/^(?:load|불러오기|불러와|読み込み)$/u],
    ['export',/^(?:export|내보내기|書き出し)$/u],['import',/^(?:import save|파일 가져오기|세이브 가져오기|セーブ取込)$/u],
    ['mod',/^(?:import mod|모드 가져오기|mod取込)$/u],['clearMods',/^(?:clear mods|모드 해제|mod解除)$/u],
    ['previous',/^(?:previous world|이전 세계|前の世界)$/u],
    ['new',/^(?:new world|새 세계|新世界)$/u],
    ['ai',/^(?:enable ai|ai 활성화|ai有効化)$/u],['demo',/^(?:demo mode|데모 모드|デモモード)$/u],
    ['legends',/^(?:legends|achievements|milestones|전설|업적|伝説|実績)$/u],
    ['home',/^(?:focus home|세계수로|세계수로 돌아가기|世界樹へ)$/u],['battle',/^(?:show battle|전장 보여줘|戦場を見せて)$/u]
  ];
  for(const [name,pattern]of meta)if(exact(s,pattern))return {type:'meta',name};
  if(exact(s,/^(?:pause|일시정지|一時停止)$/u))return {type:'meta',name:'speed',value:0};
  if(exact(s,/^(?:resume|계속|재개|再開)$/u))return {type:'meta',name:'speed',value:1};
  let m=s.match(/^(?:speed|속도|速度)\s*(0|1|4|12)(?:배|倍)?$/u);
  if(m)return {type:'meta',name:'speed',value:Number(m[1])};
  if(exact(s,/^(?:dark(?: mode)?|다크(?: 모드)?|어둡게(?: 해줘)?|ダークモード)$/u))return {type:'meta',name:'theme',value:'dark'};
  if(exact(s,/^(?:light(?: mode)?|라이트(?: 모드)?|밝게(?: 해줘)?|ライトモード)$/u))return {type:'meta',name:'theme',value:'light'};
  m=s.match(/^(?:language|언어|言語)\s*(ko|en|ja|한국어|영어|일본어|korean|english|japanese|韓国語|英語|日本語)$/u);
  if(m)return {type:'meta',name:'locale',value:/ko|한국어|korean|韓国語/u.test(m[1])?'ko':/en|영어|english|英語/u.test(m[1])?'en':'ja'};
  if(exact(s,/^(?:sound on|소리 켜|音オン)$/u))return {type:'meta',name:'sound',value:true};
  if(exact(s,/^(?:sound off|소리 꺼|音オフ)$/u))return {type:'meta',name:'sound',value:false};
  if(exact(s,/^(?:reduce motion|움직임 줄여|動きを減らす)$/u))return {type:'meta',name:'motion',value:true};
  if(exact(s,/^(?:restore motion|움직임 복원|動きを戻す)$/u))return {type:'meta',name:'motion',value:false};
  m=s.match(/^(?:difficulty|난이도|難易度)\s*(steady|changing|gentle)$/u);
  if(m)return {type:'meta',name:'difficulty',value:m[1]};
  m=s.match(/^(?:priest personality|사제 성격|司祭性格)\s*(careful|hopeful)$/u);
  if(m)return {type:'meta',name:'personality',value:m[1]};
  // Divine lightning during a raid. Exact phrases only, so negation never strikes.
  if(exact(s,/^(?:please )?(?:smite(?: (?:the |our )?(?:raiders|enemies|enemy|invaders|attackers|foes))?|(?:strike|hit|blast) (?:the |our )?(?:raiders|enemies|enemy|invaders|attackers|foes) with (?:divine )?lightning|(?:call down|send down|send|throw|hurl) (?:divine )?lightning(?: (?:on|at|upon) (?:the |our )?(?:raiders|enemies|enemy|invaders|attackers|foes))?|lightning strike|divine (?:lightning|wrath))$/u)
    ||exact(s,/^(?:(?:적|적들|습격자|습격자들|침략자|침략자들)(?:에게|에|을|를)?\s*)?(?:벼락|번개|천벌)(?:을|를)?\s*(?:내려|내려라|내려줘|떨어뜨려|떨어뜨려라|내리쳐|내리쳐라)?$/u)
    ||exact(s,/^(?:(?:敵|襲撃者|侵略者)(?:たち)?に)?(?:雷|天罰)(?:を)?(?:落とせ|落として|下せ|下して)?$/u))return {type:'order',name:'smite'};
  if(exact(s,/^(?:(?:알아서\s*)?(?:전투(?:를)?\s*준비|습격(?:에)?\s*대비|마을\s*방어(?:를)?\s*준비)(?:해|해줘|하라|해라|하세요)?|(?:please )?(?:prepare (?:for )?(?:battle|combat)|get ready for battle|prepare our defenses)(?: automatically)?|(?:自動で)?(?:戦闘準備|襲撃に備えて|防衛を準備して))$/u))
    return {type:'decision',name:'respond',kind:'raid'};
  if(exact(s,/^(?:(?:(?:전투|전쟁)(?:가)?\s*(?:끝나면|종료\s*후|후)\s*)?(?:방어\s*시설|전투\s*시설|장애물)(?:을|들(?:을)?)?\s*(?:정리|철거|삭제|제거|치워)(?:해|해줘|하라|해라|줘)?|(?:clean up|remove) (?:the )?(?:battlefield|defenses|battle objects)(?: after (?:the )?battle)?|(?:戦闘後に)?(?:防衛設備|障害物)を(?:片付けて|撤去して))$/u))
    return {type:'order',name:'cleanup'};
  if(exact(s,/^(?:(?:전투|전쟁)(?:가)?\s*(?:끝나면|종료\s*후|후)\s*정리(?:해|해줘|하라|해라)?|clean up after (?:the )?battle|戦闘後に片付けて)$/u))return {type:'order',name:'cleanup'};
  // Exact bounded management grammar avoids accidental action on negation.
  const amount=s.match(/\d+/u);
  if(/^(?:assign\s+\w+\s+\d+|[가-힣]+\s*(?:\d+|한|두|세|네)\s*명\s*배치(?:해)?|[一-龯]+\s*\d+人配置)$/u.test(s)){
    const roles=Object.entries(roleWords).filter(([,re])=>re.test(s));
    const n=amount?Number(amount[0]):({한:1,두:2,세:3,네:4}[s.match(/(한|두|세|네)\s*명/u)?.[1]]);
    return roles.length===1?{type:'order',name:'labor',role:roles[0][0],amount:n}:{type:'invalid'};
  }
  m=s.match(/^(?:cancel\s+|건설 취소\s+)(job-\d+)$/u)??s.match(/^(job-\d+)取消$/u);
  if(m)return {type:'order',name:'cancel',id:m[1]};
  m=s.match(/^(?:repair\s+|수리\s+)([a-z_]+\d+)$/u)??s.match(/^([a-z_]+\d+)修理$/u);
  if(m)return {type:'order',name:'repair',id:m[1]};
  m=s.match(/^(?:buy\s+)(food|herbs|cloth|sheep)$/u)??s.match(/^(식량|약초|천|양)\s*구매$/u)??s.match(/^(食料|薬草|布|羊)購入$/u);
  if(m)return {type:'order',name:'buy',resource:({식량:'food',약초:'herbs',천:'cloth',양:'sheep',食料:'food',薬草:'herbs',布:'cloth',羊:'sheep'})[m[1]]??m[1]};
  if(exact(s,/^(?:hunt|사냥|狩猟)$/u))return {type:'order',name:'hunt'};
  if(exact(s,/^(?:protect herd|가축 보호|家畜保護)$/u))return {type:'order',name:'herd'};
  m=s.match(/^(accept|decline|수락|거절)\s+(proposal-\d+)$/u)??((j)=>j?[j[0],j[2],j[1]]:null)(s.match(/^(proposal-\d+)(承諾|拒否)$/u));
  if(m)return {type:'order',name:'offer',id:m[2],accept:['accept','수락','承諾'].includes(m[1])};
  const ids=s.match(/(?:forecast|caravan|proposal)-\d+|wolves-\d+/gu)??[];
  const id=ids[0];
  const kind=Object.entries(kinds).filter(([,re])=>re.test(s));
  if(/^(?:ignore|respond)\b/u.test(s)||/맡겨|넘겨|대응(?:해)?$|任せる|対応$/u.test(s)){
    if(/말|않|하지|don't|not|ない|\b(?:if|unless|and|or)\b|만약|하면|다면|もし/u.test(s)||kind.length>1||ids.length>1)return {type:'invalid'};
    return {type:'decision',name:/ignore|맡겨|넘겨|任せる/u.test(s)?'ignore':'respond',...(id?{id}:{}),...(kind.length?{kind:kind[0][0]}:{})};
  }
  const disaster=Object.entries(kinds).find(([kind,re])=>['fire','flood','cold'].includes(kind)&&re.test(s));
  if(disaster&&/^(?:prepare (?:fire|flood|cold)|(?:산불|화재|홍수|한파)(?:부터|에)?\s*대비(?:해|해줘)?|(?:火災|洪水|寒波)対策)$/u.test(s))
    return {type:'decision',name:'respond',kind:disaster[0]};
  // Meta-like malformed text must never become a food grant or an action.
  if(/^(?:show|save|load|import|export|assign|buy|repair|cancel|speed|language)\b|보여줘|얼마|몇 명|알려줘|見せて|いくつ/u.test(s))return {type:'invalid'};
  return null;
}

export function validOrder(o) {
  if(!o||o.type!=='order')return false;
  if(o.name==='smite')return true;
  if(o.name==='dungeon')return o.operation==='policy'&&['safe','treasure','hunt'].includes(o.value)||o.operation==='route'&&ROUTES.includes(o.value)||o.operation==='light'&&['faith','coal'].includes(o.value);
  if(o.name==='religion')return validReligionOrder(o);
  if(o.name==='useGoods')return ['crafts','medicine'].includes(o.resource);
  if(o.name==='equipment')return validEquipmentOrder(o);
  if(['workshop','produce','cancelProduction'].includes(o.name))return validProductionOrder(o);
  if(o.name==='expedition')return ['deeper','supply'].includes(o.operation)&&(o.missionId===undefined||Number.isSafeInteger(o.missionId)&&o.missionId>=0);
  if(['trade','tradePolicy'].includes(o.name))return validTradeIntent(o);
  if(o.name==='cleanup')return o.planId===undefined||o.planId===null||typeof o.planId==='string'&&/^forecast-\d+$/u.test(o.planId);
  if(o.name==='labor')return JOBS.includes(o.role)&&Number.isInteger(o.amount)&&o.amount>=0&&o.amount<=100000;
  if(['cancel','repair','offer'].includes(o.name))return typeof o.id==='string'&&/^[a-z_-]+\d+$/u.test(o.id)&&(o.name!=='offer'||typeof o.accept==='boolean');
  return o.name==='buy'?Object.hasOwn(GOODS,o.resource):['hunt','herd','cleanup'].includes(o.name);
}
export function executeChatOrder(world,order,onEvent=()=>{}) {
  if(!validOrder(order))return failure('invalid');
  const conflict=religionConflict(world.state,null,order);if(conflict)return conflict;
  if(order.name==='smite'){const r=smiteRaiders(world);return r.ok?{...r,event:{source:'divine',action:'smite',actor:'home',time:world.state.time,position:r.position,messageKey:r.messageKey,messageParams:r.messageParams}}:r;}
  if(order.name==='dungeon')return dungeonOrder(world,order);
  if(order.name==='religion')return religionOrder(world,order);
  if(order.name==='useGoods'&&order.resource==='crafts'&&world.state.religion)return religionOrder(world,{type:'order',name:'religion',operation:'rite',id:'harvest'});
  if(order.name==='equipment'){const r=executeEquipmentOrder(world,order);if(r.ok){world.state.hero.equipment.visible=true;return {...r,event:{source:'divine',actor:'home',action:'equipment_order',time:world.state.time,messageKey:r.messageKey,messageParams:r.messageParams}};}return r;}
  if(order.name==='expedition'){const r=orderExpedition(world,order);return r.ok?{...r,event:{source:'divine',action:'expedition_order',actor:'home',time:world.state.time,messageKey:r.messageKey,messageParams:r.messageParams}}:r;}
  if(['trade','tradePolicy'].includes(order.name)){
    const result=order.name==='trade'?tradeBasket(world,order):setTradePolicy(world,order);
    return result.ok?{...result,event:{source:'divine',action:'merchant_order',actor:'home',time:world.state.time,messageKey:result.messageKey,messageParams:result.messageParams}}:result;
  }
  if(!canSpendFaith(world.state,2))return {ok:false,code:'insufficient_faith',messageKey:'event.divine.failure.insufficient_faith',messageParams:{cost:2,available:Math.floor(world.state.faith.points)}};
  const r=order.name==='useGoods'?useProducedGoods(world,order.resource):order.name==='workshop'?queueConstruction(world,{action:`build_${order.facility}`,parameters:{}})
    :order.name==='produce'?queueProduction(world,order.recipeId,order.count)
    :order.name==='cancelProduction'?cancelProduction(world,order.recipeId)
    :order.name==='labor'?assignLabor(world,order.role,order.amount)
    :order.name==='cancel'?cancelConstruction(world,order.id):order.name==='repair'?queueConstruction(world,{action:'repair'},{repairId:order.id})
    :order.name==='buy'?tradeWithCaravan(world,order.resource):order.name==='hunt'?hunt(world):order.name==='herd'?protectHerd(world)
    :order.name==='cleanup'?requestBattleCleanup(world,order.planId):respondCounteroffer(world,order.id,order.accept,onEvent);
  if(!r.ok)return r;
  spendFaith(world.state,2);
  const event={source:'divine',action:'management_order',actor:'home',time:world.state.time,messageKey:'cw.order',messageParams:{order:order.original??order.name}};
  return {...r,ok:true,event,messageKey:r.messageKey??event.messageKey,messageParams:r.messageParams??event.messageParams};
}

export class ChatCommands {
  constructor(game,{files}={}) {this.game=game;this.files=files;}
  async send(message) {
    const g=this.game,s=g.world.state,t=(key,p)=>g.i18n.t(key,p);
    let command=parseChatCommand(message);
    if ((!command||command.type==='invalid')&&isTradeMessage(message)) {
      const visit=s.life?.caravan;
      if(visit?.stage!=='visiting')return {ok:false,messageKey:'trade.unavailable',messageParams:{}};
      visit.manualHoldUntil=s.time+60;
      try { command=await g.localAI.interpretTrade(message); }
      finally {if(s.life?.caravan===visit)visit.manualHoldUntil=0;}
      if(s.life?.caravan!==visit||s.time>=visit.departAt)return {ok:false,messageKey:'trade.expired',messageParams:{}};
      if(!validTradeIntent(command))return failure('invalid');
    }
    if(this.clarification && /^(?:forecast|caravan|proposal|wolves)-\d+$/u.test(message.trim()))command={...this.clarification,id:message.trim()};
    this.clarification=null;
    if(command?.type==='invalid')return failure('invalid');
    try {
      if(command?.type==='meta') {
        const c=command,h=g.world.getVillage('home');let reply=t('cw.done');
        if(c.name==='question') {
          if(c.topic==='religion'){g.religionPanel?.show(true);reply=g.religionPanel?t('religion.panelOpened'):religionSummary(s,g.i18n);}
          else if(c.topic==='production')reply=productionSummary(g.world,g.i18n);
          else if(c.topic==='hero')reply=t('hero.stats',{level:s.hero.level,xp:s.hero.xp,hp:s.hero.hp,maxHp:s.hero.maxHp})+' · '+t('hero.mode.'+s.hero.mode);
          else if(c.topic==='events')reply=t('religion.query')+'\n'+t('weather.'+(h.weather??s.weather))+'\n'+decisionQueue(s).map(e=>e.id+' · '+t(['raid','drought','fire','flood','cold'].includes(e.kind)?'forecast.kind.'+e.kind:'cw.'+e.kind)+' · '+g.i18n.duration(Math.max(0,e.at-s.time))).join('\n');
          else if(c.topic==='buildings')reply=[...s.buildings.values(),...s.terrain.values()].map(b=>b.id+' · '+b.type).join('\n');
          else reply=[...RESOURCE_TYPES,...(h.modResources??[])].map(id=>t('resource.'+id)+' '+Math.floor(h[id])).join(' · ')+'\n'+t('faith.title')+' '+Math.floor(s.faith.points)+'/'+s.faith.capacity;
        }
        else if(c.name==='dungeon')reply=dungeonSummary(s,g.i18n)+'\n'+t('dungeon.help');
        else if(c.name==='religion'){g.religionPanel?.show(true);reply=g.religionPanel?t('religion.panelOpened'):religionSummary(s,g.i18n);}
        else if(c.name==='closeReligion'){g.religionPanel?.show(false);reply=t('cw.done');}
        else if(c.name==='help')reply=t('cw.commands')+'\n'+t('trade.help')+'\n'+t('production.help')+'\n'+t('religion.help')+'\n'+t('dungeon.help')+'\n'+t('legend.help');
        else if(['equipment','equipmentGoals','equipmentCompare','closeEquipment'].includes(c.name)){s.hero.equipment.visible=c.name!=='closeEquipment';reply=equipmentSummary(g.world,g.i18n,c.name==='equipmentCompare'?c.id:undefined);}
        else if(['production','recipes'].includes(c.name))reply=productionSummary(g.world,g.i18n,c.name==='recipes');
        else if(c.name==='trade')reply=tradeSummary(g.world,s.life?.caravan??s.life?.lastTrade,g.i18n);
        else if(c.name==='status')reply=t('counter.stats',{population:h.population,food:Math.floor(h.food),wood:Math.floor(h.wood)})+'\n'+t('story.title')+': '+t(`story.${s.story.profile}`)+' · '+t(`story.${s.story.personality}`)+'\n'+g.i18n.formatMessage(g.localAI.statusMessage);
        else if(c.name==='resources')reply=[...RESOURCE_TYPES,...(h.modResources??[])].map(id=>`${t(`resource.${id}`)} ${Math.floor(h[id])}`).join(' · ')+`\n${t('faith.title')} ${Math.floor(s.faith.points)}`;
        else if(c.name==='legends')reply=t('legend.title')+'\n'+LEGENDS.map(l=>`${Object.hasOwn(s.legends?.earned??{},l.id)?'✦':'·'} ${t('legend.name.'+l.id)} — ${t('legend.goal.'+l.id,{goal:l.goal})} (${legendProgress(s,l)}/${l.goal}) · +${l.reward} ${t('faith.title')}`).join('\n');
        else if(c.name==='labor')reply=JOBS.map(id=>`${t(`work.${id}`)}: ${h.labor[id]}`).join(' · ');
        else if(c.name==='work')reply=s.work.jobs.map(j=>`${j.id} · ${t(`work.type.${j.type}`)} · ${t(`work.status.${j.status}`)} ${Math.floor(j.progress/j.required*100)}%`).join('\n')||t('cw.empty');
        else if(c.name==='animals')reply=t('life.summary',{sheep:s.life.sheep,deer:s.life.deer,hunger:s.life.hunger});
        else if(c.name==='packs')reply=g.world.content.packs.map(p=>`${p.id} ${p.version}`).join('\n');
        else if(c.name==='metrics')reply=t('cw.metrics',{ms:((g.frameCosts??[]).reduce((a,b)=>a+b,0)/Math.max(1,g.frameCosts?.length??0)).toFixed(2),cells:g.renderer.visibleCellCount??0});
        else if(c.name==='buildings')reply=[...s.buildings.values(),...s.terrain.values()].map(b=>`${b.id} · ${b.type} · ${Math.floor(b.damage??0)}%`).join('\n');
        else if(c.name==='factions')reply=s.factions.map(f=>`${f.id} · ${t(f.nameKey)} · ${t(`faction.stance.${f.stance}`)}`).join('\n');
        else if(c.name==='events')reply=decisionQueue(s).map(e=>`${e.id} · ${t(['raid','drought','fire','flood','cold'].includes(e.kind)?`forecast.kind.${e.kind}`:`cw.${e.kind}`)} · ${g.i18n.duration(Math.max(0,e.at-s.time))}`).join('\n')||t('cw.empty');
        else if(c.name==='history')reply=(s.story?.memories??[]).slice(-20).reverse().map(e=>`${g.i18n.gameTime(e.time)} · ${g.i18n.formatMessage(e)}`).join('\n')||t('cw.empty');
        else if(c.name==='costs'){
          const basket=values=>Object.entries(values).map(([id,n])=>`${t(id==='faith'?'faith.title':`resource.${id}`)} ${n}`).join(' / ');
          reply=Object.entries(DIVINE_FAITH_COSTS).filter(([id])=>id!=='prepare_defense').map(([id,cost])=>`${t(`cw.action.${id}`)}: ${basket({faith:cost,...(['build_house','farm','build_temple'].includes(id)?buildingCost(h,id):{}),...(id.startsWith('propose_')?{food:4,silver:1}:{}),...(DISASTER_COSTS[id.replace('prepare_','')]??{})})}`).join('\n');
          reply+='\n'+Object.entries(PREPARATION_SUPPLIES).map(([id,cost])=>`${t(`combat.preparation.${id}`)}: ${basket({...cost,faith:DIVINE_FAITH_COSTS.prepare_defense[id]})}`).join('\n');
          reply+='\n'+Object.entries(GOODS).map(([id,good])=>`${t(id==='sheep'?'life.sheep':`resource.${id}`)} ×${good.quantity}: ${basket({silver:good.price})}`).join('\n');
          reply+='\n'+t('combat.smite.cost',{cost:SMITE_RULES.faith});
          reply+='\n'+t('cw.costNote');
        }
        else if(c.name==='speed')g.speed=c.value;
        else if(c.name==='theme')g.theme?.setTheme(c.value);
        else if(c.name==='locale'){reply=g.i18n.setLocale(c.value)===false?t('cw.availableLanguages',{languages:g.i18n.allowedLocales.join(', ')}):t('cw.done');}
        else if(c.name==='motion'){g.renderer.reducedMotion=c.value;globalThis.document?.body.classList.toggle('reduce-motion',c.value);}
        else if(c.name==='sound'){if(c.value){if(!await g.sound.enable())return failure('error',{error:'audio_unavailable'});}else g.sound.mute();}
        else if(c.name==='difficulty')setStoryProfile(g.world,c.value);
        else if(c.name==='personality')s.story.personality=c.value;
        else if(c.name==='home')g.renderer.focusVillage('home');
        else if(c.name==='battle'){if(!s.combat?.entry)return failure('expired');g.renderer.focusBattle();}
        else if(c.name==='ai'){await g.localAI.enable();reply=g.i18n.formatMessage(g.localAI.statusMessage);}
        else if(c.name==='demo'){g.localAI.disable();reply=g.i18n.formatMessage(g.localAI.statusMessage);}
        else return await this.files.run(c.name);
        return {ok:true,message:reply};
      }
      if(g.speed===0 && !(command?.type==='decision'&&command.name==='ignore'))return failure('paused');
      if(command?.type==='decision') {
        const chosen=selectDecision(s,command);
        if(!chosen.ok){if(chosen.code==='ambiguous')this.clarification=command;return failure(chosen.code,{choices:chosen.choices.join(', ')});}
        const card=chosen.card;
        if(command.name==='ignore'){setDecision(s,card.id,'autonomous');return {ok:true,message:t('cw.autonomous')};}
        if(card.kind==='caravan'||card.kind==='proposal')return {ok:true,message:t(card.kind==='caravan'?'cw.tradeHint':'cw.offerHint',{id:card.id})};
        const words={raid:'prepare defense',drought:'make it rain',fire:'prepare firebreaks',flood:'prepare for a flood',cold:'prepare for winter',wolves:'protect herd'};
        return this.deliver(message,{planId:card.kind==='wolves'?undefined:card.id,decisionId:card.id,
          ...(card.kind==='wolves'?{order:{type:'order',name:'herd',original:message}}:{interpretMessage:words[card.kind]})});
      }
      if(command?.name==='buy')command={type:'order',name:'trade',lines:[{side:'buy',resource:command.resource,amount:GOODS[command.resource].quantity}]};
      if(command?.type==='order'&&['trade','tradePolicy'].includes(command.name)){
        const visit=s.life?.caravan;if(visit?.stage!=='visiting')return {ok:false,messageKey:'trade.unavailable',messageParams:{}};
        const commandId=`manual:${s.life.tradeSequence=(s.life.tradeSequence??0)+1}`;
        visit.manualHoldUntil=s.time+60;
        if(command.name==='trade'){
          const offer=quoteTrade(g.world,{...command,visitId:visit.id,commandId});
          if(!offer.ok){visit.manualHoldUntil=0;return offer;}
          command={...command,quote:offer.quote};
        }
        try{return await this.deliver(message,{order:{...command,visitId:visit.id,commandId,original:message},decisionId:visit.id});}
        finally{if(s.life?.caravan===visit)visit.manualHoldUntil=0;}
      }
      if(command?.name==='equipment'&&['buy','sell'].includes(command.operation)){const v=s.life?.caravan;if(v?.stage!=='visiting')return {ok:false,messageKey:'gear.error.merchant',messageParams:{}};command={...command,visitId:v.id};}
      if(command?.type==='order')return this.deliver(message,{order:{...command,...(command.name==='cleanup'?{planId:s.combat?.planId}:{}),...(command.name==='expedition'?{missionId:s.hero?.missionId}:{}),original:message},decisionId:command.name==='offer'?command.id:undefined});
      const hint=await interpretDivineMessage(message);
      const kind={prepare_defense:'raid',create_rain:'drought',prepare_fire:'fire',prepare_flood:'flood',prepare_cold:'cold'}[hint?.action];
      const choices=kind?decisionQueue(s).filter(c=>c.kind===kind):[];
      if(choices.length>1){this.clarification={type:'decision',name:'respond',kind};return failure('ambiguous',{choices:choices.map(c=>c.id).join(', ')});}
      return this.deliver(message,choices.length===1?{planId:choices[0].id,decisionId:choices[0].id}:{});
    } catch(error){return failure(error.message==='busy'?'busy':'error',{error:error.message});}
  }
  async deliver(message,options) {
    const s=this.game.world.state;
    if(options.decisionId)setDecision(s,options.decisionId,'receiving');
    const result=await this.game.sendDivineMessage(message,'home',options);
    if(options.decisionId)setDecision(s,options.decisionId,result.ok?'responded':'failed');
    return result;
  }
}
