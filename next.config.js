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
  // Increase body size limit for API routes and middleware
  experimental: {
    middlewareClientMaxBodySize: '200mb',
  },
  // For App Router API routes, we also need to handle this at the route level
}

module.exports = nextConfig
