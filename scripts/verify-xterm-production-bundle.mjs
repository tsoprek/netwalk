import { readFile, readdir } from "node:fs/promises";

const assetsDir = new URL("../dist/assets/", import.meta.url);
const assetNames = (await readdir(assetsDir)).filter((name) => name.endsWith(".js"));
const assets = await Promise.all(
  assetNames.map(async (name) => ({
    name,
    source: await readFile(new URL(name, assetsDir), "utf8"),
  })),
);

const methodPattern = /requestMode\([^)]*\)\{/;
const xtermAsset = assets.find(({ source }) => methodPattern.test(source));
if (!xtermAsset) {
  throw new Error("Unable to find xterm requestMode in the production bundle");
}

const methodStart = xtermAsset.source.search(methodPattern);
const methodPrefix = xtermAsset.source.slice(methodStart, methodStart + 1_500);
const enumInitializer = methodPrefix.match(
  /(?:(?:void 0|undefined)|[A-Za-z_$][\w$]*)\|\|\(([A-Za-z_$][\w$]*)=\{\}\)/,
);

if (!enumInitializer) {
  throw new Error(`Unable to verify xterm requestMode enum in ${xtermAsset.name}`);
}

const binding = enumInitializer[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const beforeInitializer = methodPrefix.slice(0, enumInitializer.index);
const localDeclaration = new RegExp(`(?:let|var|const)\\s+[^;]*\\b${binding}\\b`);
if (!localDeclaration.test(beforeInitializer)) {
  throw new Error(
    `xterm requestMode has an undeclared ${enumInitializer[1]} binding in ${xtermAsset.name}`,
  );
}

console.log(`Verified xterm requestMode binding in ${xtermAsset.name}`);
