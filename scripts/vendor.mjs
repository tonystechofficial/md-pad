// Copies the browser builds of marked and DOMPurify into public/vendor,
// so the page loads nothing from a third-party CDN.
import { copyFileSync, mkdirSync } from "node:fs";

mkdirSync("public/vendor", { recursive: true });
copyFileSync("node_modules/marked/lib/marked.esm.js", "public/vendor/marked.esm.js");
copyFileSync("node_modules/dompurify/dist/purify.es.mjs", "public/vendor/purify.es.mjs");
console.log("vendor: marked + dompurify copied to public/vendor");
