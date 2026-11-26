import { randomBytes } from 'node:crypto';
import { availableTimes, bookingDateIsValid, bookingDuration } from '../lib/booking.js';
import { config } from '../lib/config.js';
import { clientIp, errorPage, isSameOrigin, redirect } from '../lib/http.js';
import { createMailer, sendMail } from '../lib/mail.js';
import { allowSubmission } from '../lib/ratelimit.js';
import { confirmBooking, removeBooking, reserve, takenCells } from '../lib/store.js';

const CONSENT = 'Elfogadom az adatkezelési tájékoztatót';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

class FormError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export async function POST(request) {
  let returnUrl = '/kapcsolat.html';
  try {
    const contentType = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!['application/x-www-form-urlencoded', 'multipart/form-data'].includes(contentType)) {
      throw new FormError('Nem támogatott űrlapformátum.', 415);
    }
    if (Number(request.headers.get('content-length') || 0) > 16384) throw new FormError('A beküldött űrlap túl nagy.', 413);
    if (!isSameOrigin(request)) throw new FormError('Az űrlap csak erről a weboldalról küldhető el.', 403);

    const form = await request.formData();
    const field = (key, max = 2000) => {
      const raw = form.get(key) ?? '';
      if (typeof raw !== 'string') throw new FormError('Ellenőrizd a megadott adatokat.');
      const value = raw.trim();
      if (value.length > max) throw new FormError('Az egyik megadott mező túl hosszú.');
      return value;
    };

    const type = field('form_type', 20);
    if (type === 'booking') returnUrl = '/szolgaltatasok.html#idopontfoglalas';
    if (field('fax_number', 100) !== '') throw new FormError('Az űrlap ellenőrzése sikertelen.');

    const name = field('name', 120);
    const email = field('email', 254);
    const phone = field('phone', 50);
    if (name === '' || !EMAIL.test(email)) throw new FormError('Add meg a nevedet és egy érvényes e-mail-címet.');

    const ip = clientIp(request);
    if (type === 'contact') return await handleContact({ field, name, email, phone, ip });
    if (type === 'booking') return await handleBooking({ field, name, email, phone, ip });
    throw new FormError('Ismeretlen űrlaptípus.');
  } catch (error) {
    if (error instanceof FormError) return errorPage(error.message, error.status, returnUrl);
    console.error('orsbuilds submit error:', error?.message);
    return errorPage('Váratlan hiba történt. Kérjük, próbáld újra később.', 500, returnUrl);
  }
}

async function handleContact({ field, name, email, phone, ip }) {
  const company = field('company', 160);
  const service = field('service', 160);
  const website = field('website', 300);
  const message = field('message', 5000);
  if (service === '' || message === '' || field('privacy_consent', 100) !== CONSENT) {
    throw new FormError('Töltsd ki a kötelező mezőket, és fogadd el az adatkezelési tájékoztatót.');
  }
  if (!config.contactTopics.includes(service)) throw new FormError('Válassz érvényes témát.');
  if (website !== '') {
    let valid = false;
    try { valid = ['http:', 'https:'].includes(new URL(website).protocol); } catch { /* érvénytelen */ }
    if (!valid) throw new FormError('A weboldal címe nem érvényes URL.');
  }
  if (!(await allowSubmission('portfolio-form', ip, 30))) {
    throw new FormError('Kérlek, várj fél percet a következő beküldés előtt.', 429);
  }

  let mailer;
  try {
    mailer = createMailer();
    await sendMail(mailer, {
      to: config.recipient,
      replyTo: email,
      replyToName: name,
      subject: 'Új kapcsolatfelvétel – ORS Digital',
      text: `Új kapcsolatfelvételi üzenet érkezett.\n\nNév: ${name}\nE-mail: ${email}\nTelefon: ${phone}\nCégnév: ${company}\nTéma: ${service}\nWeboldal: ${website}\n\nÜzenet:\n${message}\n\nAdatkezelési tájékoztató elfogadva: igen\n`,
    });
  } catch (error) {
    console.error('orsbuilds contact email error:', error?.message);
    throw new FormError('Az üzenetet most nem sikerült e-mailben elküldeni. Kérjük, próbáld újra később.', 503);
  }
  // Automatikus válasz az ügyfélnek; a hibája nem akadályozza meg a sikeres beküldést.
  await sendMail(mailer, {
    to: email,
    toName: name,
    replyTo: config.recipient,
    replyToName: config.fromName,
    subject: 'Megkaptam az üzenetedet – ORS Digital',
    text: `Kedves ${name}!\n\nKöszönöm az üzenetedet, megkaptam. Hamarosan, általában 1–2 munkanapon belül válaszolok.\n\nTéma: ${service}\nÜzeneted:\n${message}\n\nHa közben eszedbe jut valami, válaszolj erre az e-mailre.\n\nÜdvözlettel,\nSimonyi Örs\norsbuilds`,
  }).catch((error) => console.error('orsbuilds contact confirmation email error:', error?.message));
  return redirect(config.successUrl);
}

async function handleBooking({ field, name, email, phone, ip }) {
  const date = field('date', 10);
  const time = field('time', 5);
  const service = field('package', 80);
  const details = field('details', 3000);
  if (phone.length < 6) throw new FormError('Adj meg egy érvényes telefonszámot.');
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new FormError('Válassz egy érvényes szabad időpontot.');
  if (field('privacy_consent', 100) !== CONSENT) throw new FormError('Fogadd el az adatkezelési tájékoztatót a foglaláshoz.');
  const duration = bookingDuration(service);
  if (duration < 1 || !bookingDateIsValid(date)) {
    throw new FormError('Válassz érvényes, hétköznapra eső dátumot és szolgáltatást a következő 90 napból.');
  }
  if (!(await allowSubmission('portfolio-booking', ip, 30))) {
    throw new FormError('Kérlek, várj fél percet a következő foglalás előtt.', 429);
  }

  const taken = await takenCells(date).catch((error) => {
    console.error('orsbuilds booking read error:', error?.message);
    throw new FormError('Az időpontfoglalás jelenleg nem érhető el. Kérjük, próbáld újra később.', 503);
  });
  const slotTakenMessage = 'Ezt az időpontot időközben lefoglalták. Válassz egy másik szabad időpontot.';
  if (!availableTimes(date, service, taken).includes(time)) throw new FormError(slotTakenMessage);

  const id = randomBytes(4).toString('hex').toUpperCase();
  let result;
  try {
    result = await reserve({ id, name, email, phone, service, date, time, duration, details });
  } catch (error) {
    console.error('orsbuilds booking save error:', error?.message);
    throw new FormError('A foglalást nem sikerült rögzíteni. Kérjük, próbáld újra később.', 503);
  }
  if (!result.ok) throw new FormError(slotTakenMessage);

  // Az időpont csak akkor marad foglalt, ha a foglalás e-mailje eljutott hozzád.
  // Ha az értesítő levél nem megy ki, a foglalás visszavonódik, és az időpont újra szabad.
  const booking = { id, name, email, phone, service, date, time, duration, details };
  const dateLabel = `${date.replaceAll('-', '. ')}.`;
  let mailer;
  try {
    mailer = createMailer();
    await sendMail(mailer, {
      to: config.recipient,
      replyTo: email,
      replyToName: name,
      subject: 'Új időpontfoglalás – ORS Digital',
      text: `Új időpontfoglalás (#${id})\n\nNév: ${name}\nE-mail: ${email}\nTelefon: ${phone}\nSzolgáltatás: ${service}\nIdőpont: ${dateLabel}, ${time} (magyar idő)\nIdőtartam: ${duration} perc\nAdatkezelési tájékoztató elfogadva: igen\n\nMegjegyzés:\n${details}\n`,
    });
  } catch (error) {
    console.error('orsbuilds booking admin email error:', error?.message);
    await removeBooking(booking).catch((cleanupError) => console.error('orsbuilds booking rollback error:', cleanupError?.message));
    throw new FormError('A foglalást most nem sikerült elküldeni, ezért az időpont nem lett lefoglalva. Kérjük, próbáld újra később, vagy írj az info.orsbuilds@gmail.com címre.', 503);
  }

  try {
    await confirmBooking(booking);
  } catch (error) {
    console.error('orsbuilds booking confirm error:', error?.message);
    await removeBooking(booking).catch(() => {});
    throw new FormError('A foglalást nem sikerült véglegesíteni. Kérjük, próbáld újra később.', 503);
  }

  // A visszaigazoló levél hibája már nem vonja vissza a foglalást.
  const mailErrors = [];
  await sendMail(mailer, {
    to: email,
    toName: name,
    replyTo: config.recipient,
    replyToName: config.fromName,
    subject: 'Időpontfoglalás visszaigazolása – ORS Digital',
    text: `Kedves ${name}!\n\nSikeresen rögzítettük az időpontfoglalásodat.\n\nSzolgáltatás: ${service}\nIdőpont: ${dateLabel}, ${time} (magyar idő)\nIdőtartam: ${duration} perc\nFoglalási azonosító: ${id}\n\nLemondás: a weboldalon, az időpontfoglalás alatti „Időpont lemondása” űrlapon add meg az azonosítót és ezt az e-mail-címet. Kérdés vagy módosítás esetén válaszolj erre az e-mailre.\n\nÜdvözlettel,\norsbuilds`,
  }).catch((error) => { console.error('orsbuilds booking confirmation email error:', error?.message); mailErrors.push('customer'); });

  const query = new URLSearchParams({ id });
  if (mailErrors.length) query.set('email', 'failed');
  return redirect(`${config.bookingSuccessUrl}?${query}`);
}
