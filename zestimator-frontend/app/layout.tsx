import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Zestimator',
  description: 'Guess the house price',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="site-header-inner">
            <Link href="/" className="brand-mark" aria-label="Zestimator home">
              <span className="brand-e">z</span>
              <span className="brand-rest">estimator</span>
            </Link>
            <div className="search-shell" aria-hidden="true">
              <span className="search-pill">Market Rooms</span>
            </div>
            <Link href="/" className="header-action">
              Start Playing
            </Link>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
