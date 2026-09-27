import assert from 'node:assert/strict';
import { elapsedClock, durationParts, GAME_DAY_SECONDS } from '../src/game/GameTime.js';
import { daylight } from '../src/game/Presentation.js';
import { I18n, catalogues } from '../src/i18n/I18n.js';

for (const [value, expected] of [[0, '00:00'], [1, '00:01'], [59, '00:59'], [60, '01:00'],
  [119, '01:59'], [120, '02:00'], [3600, '60:00'], [86400, '1440:00'], [1.99, '00:01'],
  [-1, '00:00'], [Infinity, '00:00'], [NaN, '00:00'], [undefined, '00:00']]) {
  assert.equal(elapsedClock(value), expected, String(value));
}
assert.deepEqual(durationParts(0), { minutes: 0, seconds: 0 });
assert.deepEqual(durationParts(59), { minutes: 0, seconds: 59 });
assert.deepEqual(durationParts(60), { minutes: 1, seconds: 0 });
assert.deepEqual(durationParts(61), { minutes: 1, seconds: 1 });
assert.deepEqual(durationParts(0.1), { minutes: 0, seconds: 1 }, 'a positive remaining duration never displays zero');
assert.deepEqual(durationParts(59.1), { minutes: 1, seconds: 0 });
assert.deepEqual(durationParts(-20), { minutes: 0, seconds: 0 });
assert.equal(GAME_DAY_SECONDS, 120);
assert.equal(daylight(GAME_DAY_SECONDS - 1).day, 1);
assert.equal(daylight(GAME_DAY_SECONDS).day, 2, 'display time matches the existing visual day without changing balance');

const forbidden = /\bticks?\b|틱|ティック|시각\s*\d|時刻/iu;
const expected = {
  en: { elapsed: 'Elapsed 01:05', short: '5 sec', long: '1 min 5 sec', exact: '1 min' },
  ko: { elapsed: '경과 01:05', short: '5초', long: '1분 5초', exact: '1분' },
  ja: { elapsed: '経過 01:05', short: '5秒', long: '1分5秒', exact: '1分' },
};
const deadlineRecord = Object.freeze({ messageKey: 'forecast.event.active_drought',
  messageParams: Object.freeze({ end: 125, tick: 100, severity: 2 }) });
for (const locale of ['ko', 'en', 'ja']) {
  const i18n = new I18n({ locale, storage: null });
  assert.equal(i18n.gameTime(65), expected[locale].elapsed);
  assert.equal(i18n.duration(5), expected[locale].short);
  assert.equal(i18n.duration(65), expected[locale].long);
  assert.equal(i18n.duration(60), expected[locale].exact);
  assert.equal(i18n.formatValue({ gameTime: 65 }), expected[locale].elapsed);
  assert.equal(i18n.formatValue({ duration: 65 }), expected[locale].long);
  const clock = i18n.t('counter.clock', { day: 2, sky: i18n.t('sky.Day'), time: { gameTime: 125 } });
  assert.match(clock, /02:05/);
  assert.doesNotMatch(clock, forbidden);
  const countdown = i18n.t('forecast.countdown', { ticks: { duration: 65 }, tick: { gameTime: 125 } });
  assert.ok(countdown.includes(expected[locale].long));
  assert.match(countdown, /02:05/);
  assert.doesNotMatch(countdown, forbidden);
  const message = i18n.formatMessage(deadlineRecord);
  assert.match(message, /02:05/);
  assert.doesNotMatch(message, /125|\{\w+\}/);
  assert.doesNotMatch(message, forbidden);
  for (const [key, template] of Object.entries(catalogues[locale])) {
    assert.doesNotMatch(template.replace(/\{\w+\}/g, ''), forbidden, `${locale}:${key}: technical simulation units cannot leak into player copy`);
  }
  for (const key of ['event.divine.prepare_defense', 'event.divine.prepare_defense_forecast',
    'need.raid', 'need.raid_ready', 'event.crisis.raid', 'event.crisis.drought',
    'forecast.event.warning_raid', 'forecast.event.warning_drought', 'forecast.event.active_raid']) {
    const text = i18n.formatMessage({ messageKey: key, messageParams: {
      tick: 65, end: 125, village: { villageId: 'home' }, faction: { messageKey: 'forecast.raiders' },
    } });
    assert.match(text, /01:05|02:05/);
    assert.doesNotMatch(text, forbidden);
    assert.doesNotMatch(text, /\{\w+\}/);
  }
}
assert.deepEqual(deadlineRecord.messageParams, { end: 125, tick: 100, severity: 2 }, 'formatting never changes canonical event values');
console.log('gameTime: passed');
