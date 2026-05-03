import { readFile } from "node:fs/promises";
import { put } from "@vercel/blob/client";

const [filePath, explicitDate] = process.argv.slice(2);
const dashboardUrl = process.env.DASHBOARD_URL || "https://bull-stock.xyz";
const writeToken = process.env.OPTION_DATA_WRITE_TOKEN;

if (!filePath || !writeToken) {
  console.error("Usage: DASHBOARD_URL=https://bull-stock.xyz OPTION_DATA_WRITE_TOKEN=... node scripts/upload-options-to-blob.mjs ./options.json [YYYY-MM-DD]");
  process.exit(1);
}

const body = await readFile(filePath, "utf8");
const parsed = JSON.parse(body);
const date = explicitDate || parsed.date || new Date().toISOString().slice(0, 10);

const tokenResponse = await fetch(`${dashboardUrl.replace(/\/$/, "")}/api/options/upload-token`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${writeToken}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({ date }),
});

if (!tokenResponse.ok) {
  throw new Error(`upload-token ${tokenResponse.status}: ${await tokenResponse.text()}`);
}

const tokenPayload = await tokenResponse.json();
if (!tokenPayload.ok || !Array.isArray(tokenPayload.uploads)) {
  throw new Error(`Unexpected token response: ${JSON.stringify(tokenPayload)}`);
}

for (const upload of tokenPayload.uploads) {
  const result = await put(upload.pathname, body, {
    access: upload.access,
    token: upload.clientToken,
    contentType: upload.contentType,
    multipart: true,
  });
  console.log(`${upload.role}: ${result.pathname}`);
}
