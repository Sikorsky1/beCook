import type { NextConfig } from "next";

// Wave 8: OPENAI_BASE_URL only exists for the local E2E run (simulated OpenAI on 127.0.0.1). On
// Vercel (VERCEL is set in every build there: Production, Preview and Development) it would send
// prompts and the real key to another host, so the build fails before anything is deployed. Local
// builds, the E2E run and CI do not set VERCEL. The AI routes also refuse at runtime
// (blockedOpenAIEndpointResponse) in case the variable is added after the build.
export function assertNoOpenAIBaseUrlOnVercel(env: Record<string, string | undefined> = process.env) {
  if (env.VERCEL?.trim() && env.OPENAI_BASE_URL?.trim()) {
    throw new Error(
      "OPENAI_BASE_URL no está permitida en Vercel: quita la variable del entorno y vuelve a desplegar.",
    );
  }
}

assertNoOpenAIBaseUrlOnVercel();

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
};

export default nextConfig;
