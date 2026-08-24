import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

const repositoryEnvironment = fileURLToPath(
  new URL("../../.env", import.meta.url),
);
if (existsSync(repositoryEnvironment)) {
  loadEnvFile(repositoryEnvironment);
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@voiceinput/playground-shared"],
};

export default nextConfig;
