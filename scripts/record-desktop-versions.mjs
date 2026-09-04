import { chromium, firefox, webkit } from "playwright";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const evidence = {
  platform: process.platform,
  architecture: process.arch,
  node: process.version,
  playwright: require("playwright/package.json").version,
  browsers: {},
};
for (const [name, browserType] of Object.entries({
  chromium,
  firefox,
  webkit,
})) {
  const browser = await browserType.launch();
  try {
    evidence.browsers[name] = browser.version();
  } finally {
    await browser.close();
  }
}
console.log(JSON.stringify(evidence, null, 2));
