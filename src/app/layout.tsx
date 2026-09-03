import type { Metadata } from "next";

import "./toptutorsforus.css";

export const metadata: Metadata = {
  title: "TopTutorsForUs",
  description: "Tutoring operations: availability, booking, attendance, audit.",
  icons: {
    icon: "/favicon.svg",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
