export const PRIEST_MESSAGES = Object.freeze({
  en: Object.freeze([
    'The divine words have reached us, but their meaning escapes our understanding.',
    'The oracle has spoken, yet its meaning remains hidden. What should we do for the village?',
    'I cannot discern your will. Speak again of the need you wish us to answer.',
  ]),
  ko: Object.freeze([
    '신의 말씀이 닿았으나, 저희는 그 뜻을 헤아리지 못했습니다.',
    '신탁이 내려왔으나 뜻은 아직 감추어져 있습니다. 마을을 위해 무엇을 해야 할까요?',
    '당신의 뜻을 분별하지 못했습니다. 저희가 어떤 어려움에 응답해야 할지 다시 말씀해 주소서.',
  ]),
  ja: Object.freeze([
    '神のお言葉は届きましたが、その意味を理解できませんでした。',
    '神託は下されましたが、その意味はまだ隠されています。村のために何をすべきでしょうか。',
    '御心を読み取れません。私たちが応えるべき困難について、もう一度お告げください。',
  ]),
});

export function createPriestResponse(entity, message, replyIndex = 0) {
  if (!entity || entity.type !== 'priest') throw new TypeError('A Priest entity is required');
  const index = entity.personality === 'hopeful' ? 1 : replyIndex;
  const pool = PRIEST_MESSAGES[/[가-힣]/u.test(message) ? 'ko' : /[ぁ-んァ-ヶ一-龯]/u.test(message) ? 'ja' : 'en'];
  return { entityId: entity.id, name: entity.name, villageId: entity.villageId,
    message: pool[index % pool.length], messageKey: `priest.unclear.${index % pool.length}`, messageParams: {} };
}

// A view of the existing wandering Priest, never a second entity.
export class Priest {
  constructor(host, entity, i18n) {
    this.host = host;
    this.entity = entity;
    this.i18n = i18n;
    this.host.dataset.entityId = entity.id;
    this.reply = host.querySelector('[role="status"]');
    this.unsubscribe = i18n?.subscribe(() => this.render());
    this.render();
  }

  show(response) {
    this.response = response;
    this.render();
  }

  showRitual(state) { this.ritual = state; this.render(); }

  render() {
    this.host.querySelector('h2').textContent = this.entity.name === 'The High Priest'
      ? (this.i18n?.t('priest.name') ?? this.entity.name) : this.entity.name;
    const location = this.host.querySelector('#priest-location');
    if (location && this.i18n) location.textContent = this.i18n.t('priest.location', {
      village: { villageId: this.entity.villageId },
    });
    if (this.response) this.reply.textContent = this.i18n?.formatMessage(this.response) ?? this.response.message;
    else if (this.i18n) this.reply.textContent = this.i18n.t('priest.waiting');
    const process = this.host.querySelector('#oracle-process');
    if (process && this.i18n) {
      const stage = this.ritual?.stage ?? 'idle';
      const message = this.i18n.t(`oracle.stage.${stage}`, {
        id: this.ritual?.messageId ?? '', percent: Math.floor((this.ritual?.progress ?? 0) * 10) * 10,
      });
      if (process.textContent !== message) process.textContent = message;
      process.dataset.stage = stage;
    }
  }

  dispose() { this.unsubscribe?.(); }
}
