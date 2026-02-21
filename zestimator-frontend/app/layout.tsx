import type { Metadata } from 'next';
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
      <body>{children}</body>
    </html>
  );
}
