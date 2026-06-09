import "dotenv/config";

const baseUrl = (process.argv[2] || process.env.NODEODM_URL || "").replace(/\/$/, "");

if (!baseUrl) {
  console.error("Usage: NODEODM_URL=http://host:3001 npm run check:nodeodm");
  process.exit(1);
}

const timeout = AbortSignal.timeout(15000);

async function readJson(path) {
  const response = await fetch(`${baseUrl}${path}`, { signal: timeout });
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

try {
  const info = await readJson("/info");
  console.log(JSON.stringify({
    ok: true,
    url: baseUrl,
    version: info.version || null,
    engine: info.engine || "nodeodm",
    tasks: info.tasks || null,
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    url: baseUrl,
    error: error instanceof Error ? error.message : "Unknown NodeODM check failure",
  }, null, 2));
  process.exit(1);
}
