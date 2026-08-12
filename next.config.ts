import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /**
   * pdf-parse wraps pdf.js, which resolves its worker (`pdf.worker.mjs`) from
   * disk at runtime. Bundling it rewrites that path into `.next/`, where the
   * worker file does not exist, and every PDF upload fails with
   * "Setting up fake worker failed". Opting both packages out of Server
   * Component bundling makes Node require them from node_modules directly.
   */
  serverExternalPackages: ['pdf-parse', 'pdfjs-dist'],
};

export default nextConfig;
