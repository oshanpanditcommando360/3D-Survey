import "dotenv/config";
import cors from "cors";
import express from "express";
import { PrismaClient } from "@prisma/client";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const distDir = join(rootDir, "dist");
const port = Number(process.env.PORT || 4173);
const prisma = new PrismaClient();
const app = express();

app.use(cors());
app.use(express.json({ limit: "35mb" }));

function buildDraftModel(scan) {
  const frames = Array.isArray(scan.frames) ? scan.frames : [];
  const summary = scan.summary && typeof scan.summary === "object" ? scan.summary : {};
  const coverage = Number(summary.coverage || scan.coverage || Math.min(100, frames.length * 12));
  const length = Number((4.2 + Math.min(frames.length, 16) * 0.13).toFixed(2));
  const width = Number((2.8 + coverage * 0.012).toFixed(2));
  const wallHeight = Number((2.35 + Math.min(coverage, 100) * 0.004).toFixed(2));
  const roofHeight = Number((wallHeight + 0.9).toFixed(2));
  const x = length / 2;
  const z = width / 2;
  const y0 = -1;
  const y1 = wallHeight - 1;
  const yr = roofHeight - 1;

  const vertices = [
    [-x, y0, -z],
    [x, y0, -z],
    [x, y0, z],
    [-x, y0, z],
    [-x, y1, -z],
    [x, y1, -z],
    [x, y1, z],
    [-x, y1, z],
    [0, yr, -z],
    [0, yr, z],
  ];

  const faces = [
    { indexes: [0, 1, 2, 3], color: "#1e293b" },
    { indexes: [0, 4, 5, 1], color: "#334155" },
    { indexes: [1, 5, 6, 2], color: "#273449" },
    { indexes: [2, 6, 7, 3], color: "#475569" },
    { indexes: [3, 7, 4, 0], color: "#243244" },
    { indexes: [4, 8, 5], color: "#2563eb" },
    { indexes: [7, 6, 9], color: "#38bdf8" },
    { indexes: [4, 7, 9, 8], color: "#172033" },
    { indexes: [5, 8, 9, 6], color: "#111827" },
  ];

  const firstHeading = frames[0]?.pose?.heading || 0;
  const placement =
    scan.latitude != null && scan.longitude != null
      ? {
          latitude: scan.latitude,
          longitude: scan.longitude,
          altitude: scan.altitude || 0,
          rotation: firstHeading,
          scale: 1,
          accuracyLabel: "approximate_phone_gps",
          source: "browser_geolocation",
          horizontalAccuracyM: scan.accuracy,
        }
      : {
          latitude: null,
          longitude: null,
          altitude: 0,
          rotation: 0,
          scale: 1,
          accuracyLabel: "manual_required",
          source: "manual_required",
        };

  return {
    format: "draft-json-mesh",
    target_export: "glb",
    label: "Backend draft property model",
    dimensions_m: { length, width, height: roofHeight },
    quality: coverage >= 70 && frames.length >= 8 ? "good" : "draft",
    placement,
    coverage: {
      percent: coverage,
      coveredCells: Array.isArray(scan.coverageMap) ? scan.coverageMap.length : 0,
    },
    vertices,
    faces,
  };
}

function publicScan(scan) {
  return {
    id: scan.id,
    status: scan.status,
    progress: scan.progress,
    frame_count: scan.frameCount,
    coverage: scan.coverage,
    capture_mode: scan.captureMode,
    location_status: scan.locationStatus,
    latitude: scan.latitude,
    longitude: scan.longitude,
    model_url: scan.model ? `/api/scans/${scan.id}/model` : null,
    created_at: scan.createdAt,
    completed_at: scan.completedAt,
  };
}

async function processScan(scanId) {
  await prisma.scan.update({
    where: { id: scanId },
    data: { status: "processing", progress: 35 },
  });

  setTimeout(async () => {
    try {
      const scan = await prisma.scan.findUnique({ where: { id: scanId } });
      if (!scan) return;
      const model = buildDraftModel(scan);
      await prisma.scan.update({
        where: { id: scanId },
        data: {
          status: "complete",
          progress: 100,
          model,
          completedAt: new Date(),
        },
      });
    } catch (error) {
      await prisma.scan.update({
        where: { id: scanId },
        data: { status: "failed", progress: 100 },
      });
      console.error("Scan processing failed", error);
    }
  }, 900);
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "3d-survey-api" });
});

app.get("/api/scans", async (_req, res, next) => {
  try {
    const scans = await prisma.scan.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    res.json({ scans: scans.map(publicScan) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/scans", async (req, res, next) => {
  try {
    const payload = req.body;
    if (!Array.isArray(payload.frames) || payload.frames.length === 0) {
      return res.status(400).json({ error: "frames must be a non-empty array" });
    }

    const location = payload.location || {};
    const summary = payload.summary || {};
    const scan = await prisma.scan.create({
      data: {
        frameCount: payload.frames.length,
        coverage: Number(summary.coverage || 0),
        captureMode: payload.captureMode || "continuous-survey",
        locationStatus: payload.locationStatus || "unknown",
        latitude: typeof location.latitude === "number" ? location.latitude : null,
        longitude: typeof location.longitude === "number" ? location.longitude : null,
        altitude: typeof location.altitude === "number" ? location.altitude : null,
        accuracy: typeof location.accuracy === "number" ? location.accuracy : null,
        frames: payload.frames,
        coverageMap: payload.coverageMap || [],
        summary,
      },
    });

    await processScan(scan.id);
    res.status(202).json(publicScan(scan));
  } catch (error) {
    next(error);
  }
});

app.get("/api/scans/:id", async (req, res, next) => {
  try {
    const scan = await prisma.scan.findUnique({ where: { id: req.params.id } });
    if (!scan) return res.status(404).json({ error: "Scan not found" });
    res.json(publicScan(scan));
  } catch (error) {
    next(error);
  }
});

app.get("/api/scans/:id/model", async (req, res, next) => {
  try {
    const scan = await prisma.scan.findUnique({ where: { id: req.params.id } });
    if (!scan) return res.status(404).json({ error: "Scan not found" });
    if (!scan.model) return res.status(409).json({ error: "Model is not ready" });
    res.json(scan.model);
  } catch (error) {
    next(error);
  }
});

app.use(express.static(distDir));
app.use((_req, res) => {
  res.sendFile(join(distDir, "index.html"));
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(port, () => {
  console.log(`3D Survey API running at http://localhost:${port}`);
});
