import { config } from '../lib/config.js';
import { clientIp, errorPage, isSameOrigin, redirect } from '../lib/http.js';
import { createMailer, sendMail } from '../lib/mail.js';
import { allowSubmission } from '../lib/ratelimit.js';
import { cancelBooking } from '../lib/store.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ID = /^[0-9A-F]{8}$/;
const returnUrl = '/szolgaltatasok.html#lemondas';

class FormError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export async function POST(request) {
  try {
    if (Number(request.headers.get('content-length') || 0) > 4096) throw new FormError('A beküldött űrlap túl nagy.', 413);
    if (!isSameOrigin(request)) throw new FormError('Az űrlap csak erről a weboldalról küldhető el.', 403);
    const form = await request.formData();
    const field = (key, max) => {
      const raw = form.get(key) ?? '';
      if (typeof raw !== 'string' || raw.trim().length > max) throw new FormError('Ellenőrizd a megadott adatokat.');
      return raw.trim();
    };
    if (field('fax_number', 100) !== '') throw new FormError('Az űrlap ellenőrzése sikertelen.');
    const id = field('booking_id', 20).replace(/^#/, '').toUpperCase();
    const email = field('email', 254);
    if (!ID.test(id) || !EMAIL.test(email)) {
      throw new FormError('Add meg a foglalási azonosítót (8 karakter) és a foglaláskor használt e-mail-címet.');
    }
    if (!(await allowSubmission('portfolio-cancel', clientIp(request), 10))) {
      throw new FormError('Kérlek, várj egy kicsit a következő próbálkozás előtt.', 429);
    }

    let result;
    try {
      result = await cancelBooking(id, email);
    } catch (error) {
      console.error('orsbuilds cancel error:', error?.message);
      throw new FormError('A lemondás most nem sikerült. Kérjük, próbáld újra később, vagy írj az info.orsbuilds@gmail.com címre.', 503);
    }
    if (!result.ok) {
      throw new FormError(result.reason === 'past'
        ? 'Ez az időpont már elmúlt, ezért nem mondható le.'
        : 'Nem találtunk ilyen foglalást. Ellenőrizd az azonosítót és az e-mail-címet.');
    }

    // Az e-mail-küldés hibája nem vonja vissza a megtörtént lemondást.
    const { booking } = result;
    const when = `${booking.date.replaceAll('-', '. ')}., ${booking.time} (magyar idő)`;
    try {
      const mailer = createMailer();
      await sendMail(mailer, {
        to: config.recipient,
        subject: 'Időpont lemondva – ORS Digital',
        text: `Lemondott időpont (#${booking.id})\n\nNév: ${booking.name}\nE-mail: ${booking.email}\nTelefon: ${booking.phone}\nSzolgáltatás: ${booking.service}\nIdőpont: ${when}\n`,
      }).catch((error) => console.error('orsbuilds cancel admin email error:', error?.message));
      await sendMail(mailer, {
        to: booking.email,
        toName: booking.name,
        replyTo: config.recipient,
        replyToName: config.fromName,
        subject: 'Időpont lemondásának visszaigazolása – ORS Digital',
        text: `Kedves ${booking.name}!\n\nAz időpontodat lemondtuk.\n\nSzolgáltatás: ${booking.service}\nIdőpont: ${when}\nFoglalási azonosító: ${booking.id}\n\nHa szeretnél új időpontot, bármikor foglalhatsz a weboldalon.\n\nÜdvözlettel,\norsbuilds`,
      }).catch((error) => console.error('orsbuilds cancel customer email error:', error?.message));
    } catch (error) {
      console.error('orsbuilds cancel mail configuration error:', error?.message);
    }
    return redirect('/lemondas-sikeres.html');
  } catch (error) {
    if (error instanceof FormError) return errorPage(error.message, error.status, returnUrl);
    console.error('orsbuilds cancel unexpected error:', error?.message);
    return errorPage('Váratlan hiba történt. Kérjük, próbáld újra később.', 500, returnUrl);
  }
}
