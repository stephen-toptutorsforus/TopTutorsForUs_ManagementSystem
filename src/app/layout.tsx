import type { Metadata } from "next";

import "./toptutorsforus.css";

export const metadata: Metadata = {
  title: "TopTutorsForUs",
  description: "Tutoring operations: availability, booking, attendance, audit.",
  // The tab icon and the one iOS uses when a page is kept on a home screen are
  // the same 180×180 mark. `sizes` is declared rather than left to the browser
  // to sniff, and `apple` is named as well as `icon` because Safari looks for
  // `apple-touch-icon` by convention and would otherwise go hunting for a file
  // at the site root that is not there.
  icons: {
    icon: [{ url: "/img/apple-touch-icon.png", type: "image/png", sizes: "180x180" }],
    apple: [{ url: "/img/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
