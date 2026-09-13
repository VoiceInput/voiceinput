import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function validateBrowserStackConfig(source, environment = process.env) {
  const missingEnvironment = [
    "BROWSERSTACK_USERNAME",
    "BROWSERSTACK_ACCESS_KEY",
  ].filter((name) => !environment[name]?.trim());
  const problems = [];
  if (!source.includes("userName: ${BROWSERSTACK_USERNAME}"))
    problems.push("browserstack.yml must read BROWSERSTACK_USERNAME.");
  if (!source.includes("accessKey: ${BROWSERSTACK_ACCESS_KEY}"))
    problems.push("browserstack.yml must read BROWSERSTACK_ACCESS_KEY.");
  if (!/browserstackLocal:\s*true/u.test(source))
    problems.push("browserstackLocal must be enabled for local playgrounds.");
  if (!/^platforms:\s*$/mu.test(source))
    problems.push("browserstack.yml must define platforms.");
  if (!/browserName:\s*(chrome|edge)/iu.test(source))
    problems.push(
      "At least one supported branded desktop browser is required.",
    );
  return { missingEnvironment, problems };
}

function main() {
  const source = readFileSync("browserstack.yml", "utf8");
  const result = validateBrowserStackConfig(source);
  if (result.missingEnvironment.length > 0) {
    console.error(
      `Missing BrowserStack configuration: ${result.missingEnvironment.join(", ")}.`,
    );
  }
  for (const problem of result.problems) console.error(problem);
  if (result.missingEnvironment.length > 0 || result.problems.length > 0)
    process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
