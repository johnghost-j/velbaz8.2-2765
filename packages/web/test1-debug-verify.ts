// Debug : reproduit verifyInBrowser à la main sur le serveur du run.
import { chromium } from "playwright-core";

const exe = ["/usr/bin/google-chrome", "/usr/bin/chromium"].find((p) => require("node:fs").existsSync(p));
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] });
const tab = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const errors: string[] = [];
tab.on("pageerror", (e: any) => errors.push("exception: " + String(e?.message || e)));
tab.on("console", (m: any) => { if (m.type() === "error") errors.push("console: " + m.text()); });
tab.on("response", (r: any) => { if (r.status() >= 400) errors.push("requête " + r.status() + " : " + r.url()); });

const url = process.argv[2] || "http://localhost:5204/";
await tab.goto(url, { waitUntil: "networkidle", timeout: 25000 });
await tab.waitForTimeout(700);

const info = await tab.evaluate(() => {
  const root = document.getElementById("root");
  return {
    rootChildren: root ? root.children.length : -1,
    rootHTML: root ? root.innerHTML.slice(0, 400) : "(pas de #root)",
    testids: Array.from(document.querySelectorAll("[data-testid]")).map((el) => el.getAttribute("data-testid")),
    bodyText: document.body?.innerText?.slice(0, 300),
  };
});
console.log("URL:", url);
console.log("root children:", info.rootChildren);
console.log("data-testids:", JSON.stringify(info.testids));
console.log("root HTML:", info.rootHTML);
console.log("body text:", info.bodyText);
console.log("erreurs:", errors.length ? errors.join("\n  ") : "aucune");
await browser.close();
