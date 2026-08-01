import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'NEO Agent Platform',
  description: 'High-end Agentic AI Platform and Realtime Workspace',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-950 text-slate-100 font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
