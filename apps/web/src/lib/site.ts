/** The product's name lives here and only here, so renaming it is one edit. */
export const SITE = {
  name: 'jhola',
  tagline: 'split your cart, keep your cash',
  description:
    'Compare grocery prices on Blinkit, Zepto, Instamart, BigBasket, JioMart & DMart. Add your list, get the cheapest split with every fee counted. Free.',
  /** What people search for when they need jhola. */
  keywords: [
    'grocery price comparison India',
    'compare grocery prices online',
    'cheapest grocery app India',
    'Blinkit vs Zepto',
    'Zepto vs Instamart',
    'Blinkit vs Instamart',
    'Blinkit vs Zepto vs Instamart prices',
    'BigBasket vs JioMart',
    'quick commerce price comparison',
    'grocery delivery fees comparison',
    'Blinkit delivery charges',
    'Zepto delivery fee',
    'Instamart handling fee',
    'split grocery order across apps',
    'save money on groceries India',
  ],
  github: 'https://github.com/ashusnapx',
  /** Who built it, for the footer. */
  author: {
    handle: 'ashusnapx',
    photo: '/img/ashusnapx.jpg',
    github: 'https://github.com/ashusnapx',
    x: 'https://x.com/ashusnapx',
    linkedin: 'https://linkedin.com/in/ashusnapx',
    instagram: 'https://instagram.com/ashusnapx',
    coffee: 'https://www.buymeacoffee.com/ashukumare6',
  },
  /** Google Analytics 4 measurement ID (public by design; every page carries it). NEXT_PUBLIC_GA_ID overrides. */
  gaId: 'G-XFT6C4QQ24',
  /**
   * Canonical base URL. Set NEXT_PUBLIC_SITE_URL on a custom domain; on Vercel
   * the production URL is picked up automatically.
   */
  url:
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'http://localhost:3100'),
} as const;
