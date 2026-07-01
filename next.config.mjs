/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Vercel 서버리스에서는 요청 바디가 ~4.5MB 로 제한되므로
  // 대용량 영상은 서버 업로드 대신 브라우저에서 직접 분석한다(components/Uploader).
  // 로컬 자체 호스팅에서는 /api/upload 가 파일을 storage/ 에 저장한다.
};

export default nextConfig;
