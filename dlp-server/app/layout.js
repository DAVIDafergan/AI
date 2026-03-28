import "./globals.css";

export const metadata = {
  title: "DLP Shield – Admin Dashboard",
};

export default function RootLayout({ children }) {
  return (
    <html lang="he" dir="rtl">
      <body className="bg-slate-950 min-h-screen">{children}</body>
    </html>
  );
}
