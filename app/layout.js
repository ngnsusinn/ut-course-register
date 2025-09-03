import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata = {
  title: "Đăng ký học phần",
  description: "Ứng dụng đăng ký học phần",
};

export default function RootLayout({ children }) {
  return (
    <html lang="vi">
      <body className={inter.className}>{children}</body>
    </html>
  );
}