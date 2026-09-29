import type { Metadata } from 'next';
import Link from 'next/link';
import { AnalyticsToggle } from '@/components/AnalyticsToggle';
import { SiteFooter } from '@/components/SiteFooter';
import { SITE } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Privacy & how it works',
  alternates: { canonical: '/privacy' },
  description: `What ${SITE.name} stores (nothing on our servers), where prices and fees come from, and the limits of a price comparison.`,
};

const SECTIONS: { title: string; body: React.ReactNode }[] = [
  {
    title: 'What we store about you',
    body: (
      <>
        Nothing on our servers. No accounts, no database. Your list, delivery location, app logins and choices are saved in <em>your</em>{' '}
        browser only (its local storage) so they are there next time. Clearing your browser data deletes them.
      </>
    ),
  },
  {
    title: 'What happens when you compare',
    body: (
      <>
        Your list items and your delivery location (coordinates and pincode) are sent to our price service, which asks each app for prices
        at the store nearest you, the way a logged-out shopper would see them. Prices are live: a result is reused for at most a minute.
        What you type in the add box (three letters or more) goes the same way, to show real products as you type. Our servers don’t log
        your list, your typing or your location.
      </>
    ),
  },
  {
    title: 'Logging in to an app',
    body: (
      <>
        Zepto and Swiggy Instamart let other apps connect through their official sign-in: you log in on their own page, and jhola never sees
        your phone number or OTP. The sign-in token is kept in this browser. When you compare, it travels with that one comparison so our
        server can search your account’s prices (at your saved address that matches the delivery place), and your first name is read once
        for the greeting. When you tap “Add to cart” for Instamart, it puts that order into your own Instamart cart, keeping what was
        already there. The token is never stored or logged on our side. Tap × on the app to log out. Blinkit, BigBasket, JioMart and DMart
        offer no official sign-in for other apps, so jhola doesn’t ask you to log in to them.
      </>
    ),
  },
  {
    title: 'How we find your location',
    body: (
      <>
        If your browser already lets this site use your location, we use it. Otherwise we start from the rough, city-level place our host
        attaches to every visit from your internet connection (nothing extra is sent anywhere), and ask for GPS only when you tap compare,
        because it decides which nearby store’s prices are real. You can always type a pincode instead.
      </>
    ),
  },
  {
    title: 'Analytics',
    body: (
      <>
        We use Google Analytics to learn how jhola is used, so we can make it save you more: which features get used, how many items a
        comparison has, the plan total and savings, which apps answered, how fast pages load, and the grocery items added (as the item’s
        name, like “onion”, with any digits removed). It never receives your name, phone number, address, pincode or exact location; Google
        estimates a city from the visit itself. Google signals and ad personalisation are off. You can switch analytics off for this
        browser:
        <br />
        <AnalyticsToggle />
      </>
    ),
  },
  {
    title: 'Where fees come from',
    body: (
      <>
        Each app’s delivery, handling and small-cart fees change by city, time and account, and we never ask you for them. When you’re
        logged in to an app, a comparison reads your own fees and membership from your account (your recent order bills, your store and, on
        Instamart, your cart), read-only, and keeps only the fee amounts for half an hour. Otherwise we use any fee the app states live, and
        its published rules (with dates and sources, under “Apps &amp; fees”). Surge and rain fees can’t be known in advance and are never
        included.
      </>
    ),
  },
  {
    title: 'Limits',
    body: (
      <>
        Prices change by the hour and some apps block automated requests at times — when an app can’t be checked, the plan says so. Coupons,
        bank offers and member-only item prices are not included. {SITE.name} is independent and not affiliated with Blinkit, Zepto, Swiggy
        Instamart, JioMart, DMart or BigBasket; their names belong to their owners.
      </>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <>
      <main className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6 sm:py-14">
        <Link href="/" className="text-sm font-medium text-muted transition-colors hover:text-fg">
          ← back to {SITE.name}
        </Link>
        <h1 className="mt-6 text-3xl font-semibold tracking-tight sm:text-4xl">Privacy &amp; how it works</h1>
        <p className="mt-3 text-lg text-muted">Short version: your stuff stays on your device.</p>
        <div className="mt-8 divide-y divide-line rounded-2xl border border-line bg-card shadow-card">
          {SECTIONS.map((s) => (
            <section key={s.title} className="p-5 sm:p-6">
              <h2 className="text-base font-semibold">{s.title}</h2>
              <p className="mt-2 text-[0.95rem] leading-relaxed text-fg/80">{s.body}</p>
            </section>
          ))}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
