import type { Metadata, Viewport } from 'next';
import { Instrument_Sans } from 'next/font/google';
import { ThemeProvider } from 'next-themes';
import { Toaster } from 'sonner';
import { Analytics } from '@/components/Analytics';
import { SITE } from '@/lib/site';
import './globals.css';

const instrument = Instrument_Sans({ variable: '--font-instrument', subsets: ['latin'], display: 'swap' });

const HOME_TITLE = `${SITE.name}: compare Blinkit, Zepto, Instamart & more grocery prices`;

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: { default: HOME_TITLE, template: `%s · ${SITE.name}` },
  description: SITE.description,
  applicationName: SITE.name,
  keywords: [...SITE.keywords],
  authors: [{ name: SITE.author.handle, url: SITE.author.github }],
  creator: SITE.author.handle,
  publisher: SITE.name,
  category: 'shopping',
  alternates: { canonical: '/' },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1, 'max-video-preview': -1 },
  },
  // Search Console / Bing ownership, when set for the deployment.
  verification: {
    google: process.env.GOOGLE_SITE_VERIFICATION || undefined,
    other: process.env.BING_SITE_VERIFICATION ? { 'msvalidate.01': process.env.BING_SITE_VERIFICATION } : undefined,
  },
  openGraph: { type: 'website', locale: 'en_IN', siteName: SITE.name, title: HOME_TITLE, description: SITE.description, url: '/' },
  twitter: { card: 'summary_large_image', title: HOME_TITLE, description: SITE.description, creator: `@${SITE.author.handle}` },
  appleWebApp: { capable: true, title: SITE.name, statusBarStyle: 'default' },
  formatDetection: { telephone: false, address: false, email: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fafafa' },
    { media: '(prefers-color-scheme: dark)', color: '#0b0b0c' },
  ],
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en-IN"
      suppressHydrationWarning
      className={`${instrument.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
          {children}
          <Toaster
            position="bottom-center"
            toastOptions={{
              className: '!rounded-xl !border !border-[var(--line)] !bg-[var(--card)] !text-[var(--fg)] !shadow-pop !font-sans',
            }}
          />
        </ThemeProvider>
        <Analytics />
      </body>
    </html>
  );
}
