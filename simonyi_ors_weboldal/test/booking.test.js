import test from 'node:test';
import assert from 'node:assert/strict';
import { availableTimes, bookingDateIsValid, bookingDuration, bookingIsInFuture, cellsFor, slotStates } from '../lib/booking.js';

// 2026-11-18 (szerda) 10:00 magyar idő = 09:00 UTC
const now = new Date('2026-11-18T09:00:00Z');

test('szolgáltatás időtartama', () => {
  assert.equal(bookingDuration('Webshop'), 60);
  assert.equal(bookingDuration('constructor'), 0);
  assert.equal(bookingDuration('nincs ilyen'), 0);
});

test('dátum validálás: hétvége, múlt, 90 napnál távolabbi, hibás', () => {
  assert.equal(bookingDateIsValid('2026-11-18', now), true);
  assert.equal(bookingDateIsValid('2026-11-21', now), false); // szombat
  assert.equal(bookingDateIsValid('2026-11-17', now), false); // tegnap
  assert.equal(bookingDateIsValid('2027-02-16', now), true);  // +90 nap, kedd
  assert.equal(bookingDateIsValid('2027-02-17', now), false); // +91 nap
  assert.equal(bookingDateIsValid('2026-02-30', now), false);
  assert.equal(bookingDateIsValid('x', now), false);
});

test('rácspontok: 45 perc két cellát foglal', () => {
  assert.deepEqual(cellsFor('09:00', 30), ['09:00']);
  assert.deepEqual(cellsFor('09:00', 45), ['09:00', '09:30']);
  assert.deepEqual(cellsFor('09:30', 60), ['09:30', '10:00']);
});

test('mai napon csak a jövőbeli időpontok, zárásig', () => {
  const times = availableTimes('2026-11-18', 'Weboldal', new Set(), now);
  assert.equal(times[0], '10:30');
  assert.equal(times.at(-1), '16:30');
});

test('jövőbeli nap: foglalt cellák kizárják az átfedő kezdéseket', () => {
  const all = availableTimes('2026-11-19', 'Webshop', new Set(), now);
  assert.equal(all[0], '09:00');
  assert.equal(all.at(-1), '16:00'); // 60 perc, 17:00-ig
  const withBooking = availableTimes('2026-11-19', 'Webshop', new Set(['10:00', '10:30']), now);
  assert.ok(!withBooking.includes('09:30')); // 09:30–10:30 átfed
  assert.ok(!withBooking.includes('10:00'));
  assert.ok(!withBooking.includes('10:30'));
  assert.ok(withBooking.includes('09:00'));  // 09:00–10:00 még belefér
  assert.ok(withBooking.includes('11:00'));
});

test('foglalt időpont szerepel a listában, de nem szabad', () => {
  const taken = new Set(['10:00']);
  const states = slotStates('2026-11-19', 'Weboldal', taken, now);
  assert.equal(states.find((s) => s.time === '10:00').free, false);
  assert.equal(states.find((s) => s.time === '10:30').free, true);
  assert.equal(availableTimes('2026-11-19', 'Weboldal', taken, now).includes('10:00'), false);
});

test('lemondhatóság: csak a jövőbeli kezdés', () => {
  assert.equal(bookingIsInFuture('2026-11-19', '09:00', now), true);
  assert.equal(bookingIsInFuture('2026-11-17', '15:00', now), false);
  assert.equal(bookingIsInFuture('2026-11-18', '10:30', now), true);
  assert.equal(bookingIsInFuture('2026-11-18', '10:00', now), false);
});

test('bármely lefoglalt kezdés, bármely szolgáltatással, mindenki más számára foglalt lesz', () => {
  const services = ['Weboldal', 'Webshop', 'Karbantartás és szerkesztés', 'Egyéb'];
  for (const bookedService of services) {
    for (const time of availableTimes('2026-11-19', bookedService, new Set(), now)) {
      const taken = new Set(cellsFor(time, bookingDuration(bookedService)));
      for (const other of services) {
        const free = availableTimes('2026-11-19', other, taken, now);
        assert.equal(free.includes(time), false, `${bookedService} ${time} után ${other} még szabad`);
        for (const t of free) {
          const cells = cellsFor(t, bookingDuration(other));
          assert.equal(cells.some((c) => taken.has(c)), false, `átfedés: ${t}`);
        }
      }
    }
  }
});
