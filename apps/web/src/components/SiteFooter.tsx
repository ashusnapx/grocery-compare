import { CoffeeIcon, GithubLogoIcon, InstagramLogoIcon, LinkedinLogoIcon, XLogoIcon } from '@phosphor-icons/react/ssr';
import Image from 'next/image';
import Link from 'next/link';
import { SITE } from '@/lib/site';

const SOCIALS = [
  { label: 'GitHub', href: SITE.author.github, Icon: GithubLogoIcon },
  { label: 'X', href: SITE.author.x, Icon: XLogoIcon },
  { label: 'LinkedIn', href: SITE.author.linkedin, Icon: LinkedinLogoIcon },
  { label: 'Instagram', href: SITE.author.instagram, Icon: InstagramLogoIcon },
];

/** Who built it, where to find them, and the fine print — the same footer as medcompare. */
export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-card">
      <div className="mx-auto w-full max-w-5xl px-4 py-7 sm:px-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <a
              href={SITE.author.github}
              target="_blank"
              rel="me noopener noreferrer"
              aria-label={`${SITE.author.handle} on GitHub`}
              className="shrink-0 rounded-full ring-2 ring-accent/25 ring-offset-2 ring-offset-card transition-all hover:ring-accent/60"
            >
              <Image src={SITE.author.photo} alt="" width={40} height={40} className="size-10 rounded-full object-cover" />
            </a>
            <div className="leading-tight">
              <div className="text-sm font-semibold tracking-tight">{SITE.name}</div>
              <div className="text-[11.5px] text-muted">
                Built by{' '}
                <a href={SITE.author.github} target="_blank" rel="me noopener noreferrer" className="font-medium text-fg underline underline-offset-2 transition-colors hover:text-accent">
                  {SITE.author.handle}
                </a>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {SOCIALS.map(({ label, href, Icon }) => (
              <a
                key={label}
                href={href}
                target="_blank"
                rel="me noopener noreferrer"
                aria-label={label}
                title={label}
                className="grid size-9 place-items-center rounded-md text-muted transition-colors hover:bg-soft hover:text-fg"
              >
                <Icon size={17} weight="fill" aria-hidden />
              </a>
            ))}
            <a
              href={SITE.author.coffee}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-2 inline-flex items-center gap-1.5 rounded-full border border-warn-line bg-warn-soft px-3.5 py-1.5 text-[13px] font-medium text-warn transition-colors hover:brightness-95"
            >
              <CoffeeIcon size={15} weight="fill" aria-hidden /> Buy me a coffee
            </a>
          </div>
        </div>

        <p className="mt-5 border-t border-line pt-5 text-xs leading-relaxed text-muted">
          Prices are read live from each app at your location when you compare and can change before checkout, so confirm the
          total in the app itself. {SITE.name} compares prices only: it isn’t a seller and isn’t affiliated with Blinkit, Zepto,
          Swiggy Instamart, BigBasket, JioMart or DMart; their names and logos belong to their owners and identify who is being
          compared.{' '}
          <Link href="/fees" className="font-medium text-fg underline underline-offset-2 hover:text-accent">
            Grocery fees
          </Link>
          {' · '}
          <Link href="/privacy" className="font-medium text-fg underline underline-offset-2 hover:text-accent">
            Privacy
          </Link>
        </p>
      </div>
    </footer>
  );
}
