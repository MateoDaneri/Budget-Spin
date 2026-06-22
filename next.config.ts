import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // El trace de standalone (nft) detecta la ruta literal de la DB en
  // src/db/client.ts y la trata como asset estático, copiando la sqlite de
  // dev al output. La DB es estado mutable de runtime (vive en el volume de
  // Docker, la crea db:migrate al arrancar), no parte del artefacto.
  outputFileTracingExcludes: {
    "*": ["data/**"]
  },
  allowedDevOrigins: ["127.0.0.1"],
  serverExternalPackages: ["node:sqlite"]
};

export default nextConfig;
