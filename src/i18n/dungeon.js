const rows={
 summary:['빛 {light}/100 · 방침 {policy} · 엘리트 {elite} · 보스 {boss}','Light {light}/100 · Policy {policy} · Elite {elite} · Boss {boss}','光{light}/100 · 方針{policy} · エリート{elite} · ボス{boss}'],
 route:['갈림길: {options} → {choice}','Fork: {options} → {choice}','分岐: {options} → {choice}'],
 normal:['일반','Normal','通常'],elite:['엘리트','Elite','エリート'],spring:['샘','Spring','泉'],mystery:['미지','Mystery','未知'],boss:['보스','Boss','ボス'],
 safe:['안전','Safe','安全'],treasure:['보물','Treasure','宝探し'],hunt:['엘리트 사냥','Elite hunt','エリート狙い'],
 help:['“던전 안전하게/보물 찾아/엘리트 노려”, “던전 샘 선택”, “던전에 빛을 내려라”(신앙 12) / “던전 횃불 보급”(석탄 2). 빛 +40. 방에 들어가면 선택 확정.','“dungeon safe/treasure/hunt”, “choose spring”, “light dungeon” (12 faith) / “send torches” (2 coal). Light +40; entering a room commits the choice.','「ダンジョン 安全/宝探し/エリート狙い」「泉を選択」「ダンジョンに光」(信仰12) /「松明補給」(石炭2)。光+40。入室で選択確定。'],
 ordered:['원정 지시를 반영했습니다.','Expedition order applied.','遠征指示を反映しました。'],
 unavailable:['현재 원정에 적용할 수 없습니다. 전투 중에는 결산 뒤 빛을 보충하세요.','Unavailable now. Restore light after the current fight settles.','現在は適用できません。戦闘の決算後に光を補充してください。'],
 routeClosed:['이미 들어간 방이거나 이번 갈림길에 없는 선택입니다.','That room is committed or not offered at this fork.','入室済み、または今回の分岐にない選択です。'],
 full:['빛이 이미 가득합니다.','Light is already full.','光は満ちています。'],cost:['빛을 보충할 신앙·석탄이 부족합니다.','Not enough faith or coal for light.','光を補う信仰・石炭が足りません。'],invalid:['지원하지 않는 원정 지시입니다.','Unsupported expedition order.','未対応の遠征指示です。'],
 peaceful:['{kind}에서 쉬고 빛과 체력을 회복했습니다.','Recovered light and health at {kind}.','{kind}で休み光と体力を回復しました。'],
 policyOn:['커먼 자동 분해 켜짐 · 잠금·착용·상위 등급 보호. 철 저장 공간이 없으면 보존합니다.','Auto salvage common ON · locked/equipped/higher grades protected. Retained if iron storage is full.','コモン自動分解オン · 固定・装着・上位等級は保護。鉄の倉庫が満杯なら保持。'],
 policyOff:['커먼 자동 분해 꺼짐','Auto salvage common OFF','コモン自動分解オフ'],
 salvaged:['자동 정리: 커먼 {count}개 → 철 {count}','Auto salvage: {count} common → {count} iron','自動整理: コモン{count}個 → 鉄{count}'],
};
export const dungeonCatalogs=Object.fromEntries(['ko','en','ja'].map((l,i)=>[l,Object.fromEntries(Object.entries(rows).map(([k,v])=>['dungeon.'+k,v[i]]))]));
export function parseDungeonCommand(s) {
  if(/^(던전 현황|dungeon status|ダンジョン状況)$/u.test(s))return {type:'meta',name:'dungeon'};
  const commands=[['policy','safe',/^(던전 안전하게|dungeon safe|ダンジョン 安全)$/u],['policy','treasure',/^(던전 보물 찾아|dungeon treasure|ダンジョン 宝探し)$/u],['policy','hunt',/^(던전 엘리트 노려|dungeon hunt|ダンジョン エリート狙い)$/u],
    ['light','faith',/^(던전에 빛을 내려라|light dungeon|ダンジョンに光)$/u],['light','coal',/^(던전 횃불 보급|send torches|松明補給)$/u]];
  for(const [operation,value,re] of commands)if(re.test(s))return {type:'order',name:'dungeon',operation,value};
  for(const id of ['normal','elite','spring','mystery'])if([`던전 ${rows[id][0]} 선택`,`choose ${id}`,`${rows[id][2]}を選択`].includes(s))return {type:'order',name:'dungeon',operation:'route',value:id};
  if(/^(커먼 자동 분해(?: 켜|해)?|auto salvage common on|コモン自動分解オン)$/u.test(s))return {type:'order',name:'equipment',operation:'lootPolicy',value:true};
  if(/^(커먼 자동 분해 꺼|auto salvage common off|コモン自動分解オフ)$/u.test(s))return {type:'order',name:'equipment',operation:'lootPolicy',value:false};
  return null;
}
