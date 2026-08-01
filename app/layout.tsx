import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'NEO & Bean AI Platform',
  description: 'High-end Agentic AI Platform and Realtime Workspace',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, backgroundColor: '#020617', color: '#f8fafc', fontFamily: 'sans-serif' }}>
        {children}
      </body>
    </html>
  );
}
