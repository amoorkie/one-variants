import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const main = await readFile(resolve("dist/main.js"), "utf8");
const failures = [];

if (main.includes("?.")) {
  failures.push("optional chaining token `?.`");
}

if (main.includes("??")) {
  failures.push("nullish coalescing token `??`");
}

if (main.includes("...")) {
  failures.push("spread/rest token `...`");
}

if (failures.length > 0) {
  throw new Error("dist/main.js contains Figma VM risky syntax: " + failures.join(", "));
}

console.log("dist/main.js syntax guard passed");
