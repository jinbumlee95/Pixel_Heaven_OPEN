// Presentation only. Events retain stable keys and detached parameters so the
// same historical record can be read in any language without changing state.
const messages = {
  'event.divine.failure.invalid_action': [
    'This divine command is not supported.', '지원하지 않는 신의 명령입니다.', 'この神託の命令には対応していません。'],
  'event.divine.failure.invalid_target': [
    'Divine messages can reach only your settlement. External settlements and factions cannot receive this command.', '말씀은 당신의 정착지에만 닿습니다. 외부 정착지나 세력에는 이 명령을 전할 수 없습니다.', '神の言葉はあなたの集落にだけ届きます。外部の集落や勢力にはこの命令を届けられません。'],
  'event.divine.failure.invalid_context': [
    'This response no longer matches an upcoming event. Choose the event again.', '이 응답이 예고된 사건과 더 이상 맞지 않습니다. 사건을 다시 선택해 주세요.', 'この応答は予告された出来事と一致しなくなりました。出来事を選び直してください。'],
  'event.divine.failure.no_space': [
    'There is no empty ground near {village}.', '{village} 주변에 빈 땅이 없습니다.', '{village}の近くに空き地がありません。'],
  'event.divine.prepare_defense': [
    '{village} prepares defenders until {tick}.', '{village}: {tick}까지 방어 태세를 유지합니다.', '{village}は{tick}まで防衛態勢を維持します。'],
  'event.divine.prepare_defense_forecast': [
    '{village} prepares defenders for the announced raid at {tick}.', '{village}: {tick}에 예고된 습격에 맞춰 방어 준비를 마쳤습니다.', '{village}は{tick}に予告された襲撃への防衛準備を整えました。'],
  'event.divine.create_rain': [
    'Rain falls on {village}.', '{village}에 비가 내립니다.', '{village}に雨が降ります。'],
  'event.divine.create_forest': [
    'A forest grows near {village} at ({x}, {y}).', '{village} 근처 ({x}, {y})에 숲이 자랍니다.', '{village}の近くの（{x}、{y}）に森が育ちます。'],
  'event.divine.bless_village': [
    '{village} is blessed. Happiness: {happiness}.', '{village}: 축복을 받았습니다. 행복도: {happiness}.', '{village}は祝福されました。幸福度：{happiness}。'],
  'event.divine.curse_village': [
    '{village} is cursed. Happiness: {happiness}.', '{village}: 저주를 받았습니다. 행복도: {happiness}.', '{village}は呪われました。幸福度：{happiness}。'],
  'event.divine.increase_food': [
    '{village} receives {amount} food.', '{village}: 식량 {amount}을 받았습니다.', '{village}は食料を{amount}受け取りました。'],
  'event.world.start_war': [
    '{village} went to war with {target}.', '{village}: {target}에 전쟁을 선포했습니다.', '{village}は{target}に宣戦布告しました。'],
  'event.world.form_alliance': [
    '{village} formed an alliance with {target}.', '{village}: {target}과 동맹을 맺었습니다.', '{village}は{target}と同盟を結びました。'],
  'event.world.change_religion': [
    '{village} now follows {religion}.', '{village}: 이제 {religion} 신앙을 따릅니다.', '{village}は今後、{religion}を信仰します。'],
  'event.world.build_temple': [
    '{village} built a temple in response to the oracle.', '{village}: 신탁에 따라 사원을 세웠습니다.', '{village}は神託に応えて神殿を建てました。'],
  'event.world.farm': [
    '{village} cultivated a field to improve the harvest.', '{village}: 수확량을 늘리기 위해 밭을 일궜습니다.', '{village}は収穫を増やすために畑を耕しました。'],
  'event.world.build_house': [
    '{village} built a house for {people} people.', '{village}: {people}명이 머물 집을 지었습니다.', '{village}は{people}人分の住居を建てました。'],
  'event.world.trade': [
    '{village} traded {wood} wood for {food} food from {target}.', '{village}: {target}에 목재 {wood}을 주고 식량 {food}을 받았습니다.', '{village}は{target}に木材{wood}を渡し、食料{food}を受け取りました。'],
  'event.world.migrate': [
    '{people} people moved from {village} to {target}.', '{village}에서 {target}로 {people}명이 이주했습니다.', '{village}から{target}へ{people}人が移住しました。'],
  'event.world.failure.invalid_action': [
    'This village action is not supported.', '지원하지 않는 마을 행동입니다.', 'この村の行動には対応していません。'],
  'event.world.failure.invalid_target': [
    'This village action has no valid target.', '이 행동을 실행할 수 있는 대상 마을이 없습니다.', 'この行動の有効な対象となる村がありません。'],
  'event.world.failure.faith_not_ready': [
    'The village is not ready to change its faith.', '마을이 신앙을 바꿀 준비가 되지 않았습니다.', '村は信仰を変える準備ができていません。'],
  'event.world.failure.conflict_not_ready': [
    'The conditions for declaring war are not met.', '전쟁을 선포할 조건이 충족되지 않았습니다.', '宣戦布告の条件を満たしていません。'],
  'event.world.failure.already_allied': [
    'These villages are already allied.', '이미 동맹을 맺은 마을입니다.', 'これらの村はすでに同盟関係です。'],
  'event.world.failure.insufficient_wood': [
    'The village does not have enough wood.', '마을의 목재가 부족합니다.', '村の木材が足りません。'],
  'event.world.failure.temple_exists': [
    'The village already has a temple.', '마을에 이미 사원이 있습니다.', '村にはすでに神殿があります。'],
  'event.world.failure.hostile_target': [
    'Trade and migration are unavailable during war.', '전쟁 중에는 교역하거나 이주할 수 없습니다.', '戦争中は交易や移住ができません。'],
  'event.world.failure.insufficient_resources': [
    'The villages do not have enough resources for this trade.', '이 교역에 필요한 자원이 부족합니다.', 'この交易に必要な資源が足りません。'],
  'event.world.failure.insufficient_capacity': [
    'There are not enough people, housing, or food for this migration.', '이주에 필요한 인원, 주거 공간 또는 식량이 부족합니다.', '移住に必要な人数、住居、または食料が不足しています。'],
  'event.world.failure.no_space': [
    'The village has no room for this construction.', '마을에 건설할 공간이 없습니다.', '村に建設できる場所がありません。'],
  'event.world.failure.stale_decision': [
    'Conditions changed before the village could act.', '마을이 행동하기 전에 상황이 달라졌습니다.', '村が行動する前に状況が変わりました。'],
  'event.world.failure.decision_failed': [
    'The village could not reach a decision.', '마을이 결정을 내리지 못했습니다.', '村は決断に至りませんでした。'],
  'need.raid': [
    '{village}: the raid resolves at {tick}. Prepare defenders now.', '{village}: {tick}에 습격 피해가 결정됩니다. 방어를 준비하세요.', '{village}：{tick}に襲撃の被害が確定します。防衛を準備してください。'],
  'need.raid_ready': [
    '{village}: the raid resolves at {tick}. Defenders are ready.', '{village}: {tick}에 습격 피해가 결정됩니다. 방어 준비를 마쳤습니다.', '{village}：{tick}に襲撃の被害が確定します。防衛の準備は整っています。'],
  'need.drought': [
    '{village}: drought is reducing the harvest. Send rain to avert famine.', '{village}: 가뭄으로 수확량이 줄고 있습니다. 비를 내려 기근을 막으세요.', '{village}：干ばつで収穫が減っています。雨を降らせて飢饉を防いでください。'],
  'need.conflict': [
    '{village}: fighting consumes food and lives. Seek peace or prepare defenders.', '{village}: 전쟁으로 식량과 인명을 잃고 있습니다. 평화를 모색하거나 방어를 준비하세요.', '{village}：戦闘で食料と人命が失われています。和平を求めるか、防衛を準備してください。'],
  'need.faith_crisis': [
    '{village}: a new temple has prompted debate about faith.', '{village}: 새 사원이 세워지면서 신앙에 관한 논의가 시작되었습니다.', '{village}：新しい神殿をきっかけに信仰について議論が始まりました。'],
  'need.famine': [
    '{village}: famine threatens lives. Rain or food could help.', '{village}: 기근이 생명을 위협합니다. 비나 식량이 필요합니다.', '{village}：飢饉が命を脅かしています。雨や食料が助けになります。'],
  'need.low_food': [
    '{village}: food reserves are low. Rain or food could help.', '{village}: 비축 식량이 부족합니다. 비나 식량이 필요합니다.', '{village}：備蓄食料が不足しています。雨や食料が助けになります。'],
  'need.low_harvest': [
    '{village}: harvest cannot keep up with consumption. Rain or food could help.', '{village}: 수확량이 소비량을 따라가지 못합니다. 비나 식량이 필요합니다.', '{village}：収穫が消費に追いついていません。雨や食料が助けになります。'],
  'need.housing_shortage': [
    '{village}: {people} people need housing. The village is seeking space.', '{village}: {people}명이 살 집이 필요합니다. 마을이 건설 공간을 찾고 있습니다.', '{village}：{people}人分の住居が必要です。村は建設場所を探しています。'],
  'prompt.defense': [
    'Prepare our settlement’s defenses', '우리 정착지의 방어를 준비해', '私たちの集落の防衛を準備して'],
  'prompt.rain': [
    'Make it rain here', '우리 정착지에 비를 내려줘', '私たちの集落に雨を降らせて'],
  'prompt.peace': [
    'Let us live together in peace', '함께 평화롭게 살아가자', '共に平和に暮らそう'],
  'prompt.faith': [
    'Have faith', '믿음을 가져라', '信仰を持ちなさい'],
  'event.resolved.food_shortage': [
    '{village}: food supply is stable again.', '{village}: 식량 공급이 다시 안정되었습니다.', '{village}：食料供給が再び安定しました。'],
  'event.resolved.housing_shortage': [
    '{village}: everyone has room to live.', '{village}: 모두가 살 공간을 확보했습니다.', '{village}：全員の住む場所が確保されました。'],
  'event.resolved.raid': [
    '{village}: raid is resolved.', '{village}: 습격 위기가 해소되었습니다.', '{village}：襲撃の危機が解消されました。'],
  'event.resolved.drought': [
    '{village}: drought is resolved.', '{village}: 가뭄 위기가 해소되었습니다.', '{village}：干ばつの危機が解消されました。'],
  'event.resolved.conflict': [
    '{village}: conflict is resolved.', '{village}: 분쟁이 해소되었습니다.', '{village}：紛争が解消されました。'],
  'event.resolved.faith_crisis': [
    '{village}: faith crisis is resolved.', '{village}: 신앙 갈등이 해소되었습니다.', '{village}：信仰をめぐる対立が解消されました。'],
  'event.crisis.raid': [
    '{village}: raiders approach! Prepare defenders before {tick}.', '{village}: 습격자가 다가옵니다! {tick} 전에 방어를 준비하세요.', '{village}：襲撃者が接近中です！{tick}までに防衛を準備してください。'],
  'event.crisis.drought': [
    '{village}: drought threatens the harvest until {tick}. Send rain before famine follows.', '{village}: {tick}까지 가뭄이 수확을 위협합니다. 기근이 닥치기 전에 비를 내려 주세요.', '{village}：{tick}まで干ばつが収穫を脅かします。飢饉になる前に雨を降らせてください。'],
  'event.crisis.raid_resolved': [
    '{village}: raiders withdrew. Lost {food} food and {people} people.', '{village}: 습격자가 물러갔습니다. 식량 {food}과 주민 {people}명을 잃었습니다.', '{village}：襲撃者が撤退しました。食料{food}と住民{people}人を失いました。'],
  'event.crisis.raid_defended': [
    '{village}: raiders withdrew. Lost {food} food and {people} people; defenders held the line.', '{village}: 수비대가 습격자를 막아냈습니다. 식량 손실 {food}, 인명 손실 {people}명.', '{village}：守備隊が襲撃者を撃退しました。食料の損失は{food}、住民の損失は{people}人です。'],
  'event.crisis.raid_allied': [
    '{village}: raiders withdrew. Lost {food} food and {people} people; allies reduced the losses.', '{village}: 습격자가 물러갔습니다. 동맹의 도움으로 피해를 줄였지만 식량 {food}과 주민 {people}명을 잃었습니다.', '{village}：襲撃者が撤退しました。同盟の支援で被害は抑えられましたが、食料{food}と住民{people}人を失いました。'],
  'event.crisis.drought_resolved': [
    '{village}: the drought has ended.', '{village}: 가뭄이 끝났습니다.', '{village}：干ばつが終わりました。'],
  'event.crisis.conflict': [
    '{village}: conflict with {target} costs {food} food and {people} person. An alliance could end the fighting.', '{village}: {target}과의 분쟁으로 식량 {food}과 주민 {people}명을 잃었습니다. 동맹을 맺으면 전쟁을 끝낼 수 있습니다.', '{village}：{target}との紛争で食料{food}と住民{people}人を失いました。同盟を結べば戦闘を終わらせられます。'],
  'event.crisis.conflict_defended': [
    '{village}: conflict with {target} costs {food} food. An alliance could end the fighting.', '{village}: 방어 태세로 인명 피해를 막았지만 {target}과의 분쟁으로 식량 {food}을 잃었습니다. 동맹을 맺으면 전쟁을 끝낼 수 있습니다.', '{village}：防衛によって人命は守られましたが、{target}との紛争で食料{food}を失いました。同盟を結べば戦闘を終わらせられます。'],
  'event.oracle.original': [
    'You: {original}', '당신: {original}', 'あなた：{original}'],
  'event.oracle.interpretation.remembrance': [
    'I believe we should build a temple to preserve our memory. The village will decide whether it can act.', '기억을 보존할 사원을 세우라는 뜻으로 해석합니다. 마을이 실행할 수 있을지 판단할 것입니다.', '記憶を守る神殿を建てるべきだと解釈しました。実行できるかどうかは村が判断します。'],
  'event.oracle.interpretation.faith': [
    'I believe we should embrace the sky god. The village will decide whether it can act.', '하늘 신에 대한 믿음을 받아들이라는 뜻으로 해석합니다. 마을이 실행할 수 있을지 판단할 것입니다.', '天空の神への信仰を受け入れるべきだと解釈しました。実行できるかどうかは村が判断します。'],
  'event.oracle.interpretation.peace': [
    'I believe we should seek an alliance with our neighbors. The village will decide whether it can act.', '이웃과 동맹을 맺으라는 뜻으로 해석합니다. 마을이 실행할 수 있을지 판단할 것입니다.', '隣の村と同盟を結ぶべきだと解釈しました。実行できるかどうかは村が判断します。'],
  'event.oracle.interpretation.conflict': [
    'I believe we should confront a hostile neighbor. The village will decide whether it can act.', '적대적인 이웃에 맞서라는 뜻으로 해석합니다. 마을이 실행할 수 있을지 판단할 것입니다.', '敵対する隣の村に立ち向かうべきだと解釈しました。実行できるかどうかは村が判断します。'],
  'event.oracle.no_action': [
    'The village chose not to act on this interpretation.', '마을은 이 해석에 따라 행동하지 않기로 했습니다.', '村はこの解釈に従って行動しないことを選びました。'],
  'event.oracle.insufficient_wood': [
    'The village lacks wood to carry out this interpretation.', '이 해석을 실행하기에는 마을의 목재가 부족합니다.', 'この解釈を実行するには村の木材が不足しています。'],
  'event.oracle.no_space': [
    'The village has no space for this interpretation.', '마을에 이 해석을 실행할 공간이 없습니다.', '村にこの解釈を実行できる場所がありません。'],
  'event.oracle.not_applied': [
    'The village could not carry out this interpretation under its current conditions.', '현재 상황에서는 마을이 이 해석을 실행할 수 없습니다.', '現在の状況では、村はこの解釈を実行できません。'],
  'event.oracle.expired': [
    'This interpretation expired before the village could act.', '마을이 행동하기 전에 신탁 해석의 유효 시간이 지났습니다.', '村が行動する前に、この神託の解釈の有効時間が過ぎました。'],
  'event.oracle.stale': [
    'Conditions changed, so the village could not apply this interpretation.', '상황이 달라져 마을이 이 해석을 적용하지 못했습니다.', '状況が変わったため、村はこの解釈を適用できませんでした。'],
  'event.oracle.decision_failed': [
    'The village could not reach a decision on this interpretation.', '마을이 이 해석에 대한 결정을 내리지 못했습니다.', '村はこの解釈について決断に至りませんでした。'],
};

export const eventCatalogs = Object.freeze(Object.fromEntries(['en', 'ko', 'ja'].map((locale, index) =>
  [locale, Object.freeze(Object.fromEntries(Object.entries(messages).map(([key, values]) => [key, values[index]])))])));
export const eventMessages = eventCatalogs;
