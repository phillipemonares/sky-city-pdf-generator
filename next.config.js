/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['puppeteer'],
  // Performance optimizations
  compress: true,
  poweredByHeader: false,
  // Faster builds
  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: false,
  },
  // Increase body size limit for API routes (default is 10MB)
  experimental: {
    middlewareClientMaxBodySize: '50mb',
  },
}

module.exports = nextConfig
