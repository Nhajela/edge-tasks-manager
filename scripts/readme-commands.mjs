// Rewrites README.md's "Bot commands" table from src/lib/tutorial-content.ts (the single source).
// Run: node scripts/readme-commands.mjs   (Node 23.6+ loads the .ts file directly)
import { readFileSync, writeFileSync } from "node:fs";
import { commandsMarkdown } from "../src/lib/tutorial-content.ts";

const file = new URL("../README.md", import.meta.url);
const readme = readFileSync(file, "utf8");
const re = /(<!-- commands:start -->\r?\n)[\s\S]*?(\r?\n<!-- commands:end -->)/;
if (!re.test(readme)) throw new Error("README.md has no <!-- commands:start/end --> markers");
writeFileSync(file, readme.replace(re, (_, a, b) => a + commandsMarkdown("EdgeTasksBot") + b));
console.log("README.md commands table updated");
