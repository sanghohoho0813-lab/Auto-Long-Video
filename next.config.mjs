/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 대용량 영상 업로드를 위해 서버 액션/라우트 바디 사이즈 제한을 크게 잡는다.
  experimental: {
    serverActions: {
      bodySizeLimit: "2gb",
    },
  },
};

export default nextConfig;
