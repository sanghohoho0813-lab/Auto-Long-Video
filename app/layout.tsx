import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "김팀장의 롱폼 자동편집기",
  description:
    "유튜브 롱폼 강의/해설 영상을 자동으로 컷 편집 · 자막 강조 · 줌 · 스포트라이트 · B-roll · 팝업까지 편집해주는 로컬 웹앱",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
