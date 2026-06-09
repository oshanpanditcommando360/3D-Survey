import "dotenv/config";
import AdmZip from "adm-zip";
import cors from "cors";
import express from "express";
import multer from "multer";
import { PrismaClient } from "@prisma/client";
import { spawn } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { mkdir, readdir, rename, stat, writeFile } from "node:fs/promises";
import { openAsBlob } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const distDir = join(rootDir, "dist");
const storageDir = process.env.STORAGE_DIR
  ? join(rootDir, process.env.STORAGE_DIR)
  : join(rootDir, "storage");
const tmpDir = join(storageDir, "tmp");
const port = Number(process.env.PORT || 4173);
const nodeOdmUrl = process.env.NODEODM_URL?.replace(/\/$/, "");
const prisma = new PrismaClient();
const app = express();
const upload = multer({
  dest: tmpDir,
  limits: {
    fileSize: 1024 * 1024 * 1024,
    files: 250,
  },
});

await mkdir(tmpDir, { recursive: true });

app.use(cors());
app.use(express.json({ limit: "35mb" }));
app.use("/storage", express.static(storageDir));

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
    model_asset_url: scan.modelAssetUrl,
    model_asset_type: scan.modelAssetType,
    reconstruction_engine: scan.reconstructionEngine,
    node_odm_task_id: scan.nodeOdmTaskId,
    error_message: scan.errorMessage,
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

async function processMediaScan(scanId) {
  await prisma.scan.update({
    where: { id: scanId },
    data: { status: "processing", progress: 15 },
  });

  try {
    const scan = await prisma.scan.findUnique({ where: { id: scanId } });
    if (!scan?.storagePath) throw new Error("Scan storage path missing");
    const scanDir = join(rootDir, scan.storagePath);
    const inputDir = join(scanDir, "input");
    const framesDir = join(scanDir, "frames");
    const outputDir = join(scanDir, "output");
    await mkdir(framesDir, { recursive: true });
    await mkdir(outputDir, { recursive: true });

    const imagePaths = await prepareImages(inputDir, framesDir);
    if (imagePaths.length < 2) {
      throw new Error("ODM needs at least 2 images. Upload more photos or a longer video.");
    }

    await prisma.scan.update({
      where: { id: scanId },
      data: {
        progress: 30,
        frameCount: imagePaths.length,
        preparedImages: imagePaths.map((path) => relativeStoragePath(path)),
      },
    });

    if (!nodeOdmUrl) {
      const draftScan = await prisma.scan.findUnique({ where: { id: scanId } });
      const model = buildDraftModel({
        ...draftScan,
        frames: imagePaths.map((path, index) => ({ id: path, pose: { heading: index * 12 } })),
      });
      await prisma.scan.update({
        where: { id: scanId },
        data: {
          status: "complete",
          progress: 100,
          model: {
            ...model,
            assetUrl: null,
            assetType: "draft",
            note: "NODEODM_URL is not configured, so this is a draft placement model.",
          },
          reconstructionEngine: "local-draft",
          completedAt: new Date(),
        },
      });
      return;
    }

    const odmResult = await runNodeOdmJob(scanId, imagePaths, outputDir);
    const finalScan = await prisma.scan.findUnique({ where: { id: scanId } });
    const model = buildDraftModel({
      ...finalScan,
      frames: imagePaths.map((path, index) => ({ id: path, pose: { heading: index * 12 } })),
    });
    await prisma.scan.update({
      where: { id: scanId },
      data: {
        status: "complete",
        progress: 100,
        model: {
          ...model,
          assetUrl: odmResult.assetUrl,
          assetType: odmResult.assetType,
          nodeOdmTaskId: odmResult.taskId,
        },
        modelAssetUrl: odmResult.assetUrl,
        modelAssetType: odmResult.assetType,
        outputPath: relativeStoragePath(outputDir),
        nodeOdmTaskId: odmResult.taskId,
        reconstructionEngine: "nodeodm",
        completedAt: new Date(),
      },
    });
  } catch (error) {
    await prisma.scan.update({
      where: { id: scanId },
      data: {
        status: "failed",
        progress: 100,
        errorMessage: error instanceof Error ? error.message : "Unknown reconstruction failure",
      },
    });
    console.error("Media reconstruction failed", error);
  }
}

async function prepareImages(inputDir, framesDir) {
  const entries = await readdir(inputDir);
  const imagePaths = [];
  for (const entry of entries) {
    const filePath = join(inputDir, entry);
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) continue;
    if (isImage(entry)) imagePaths.push(filePath);
    if (isVideo(entry)) {
      const base = entry.replace(/\W+/g, "_").replace(/^_+|_+$/g, "");
      await extractFrames(filePath, join(framesDir, `${base}_%05d.jpg`));
    }
  }
  const frameEntries = await readdir(framesDir).catch(() => []);
  for (const entry of frameEntries) {
    if (isImage(entry)) imagePaths.push(join(framesDir, entry));
  }
  return imagePaths;
}

function isImage(name) {
  return /\.(jpe?g|png|tif|tiff)$/i.test(name);
}

function isVideo(name) {
  return /\.(mp4|mov|m4v|webm|avi)$/i.test(name);
}

async function extractFrames(videoPath, outputPattern) {
  await runCommand("ffmpeg", [
    "-y",
    "-i",
    videoPath,
    "-vf",
    "fps=1,scale=1600:-2",
    "-q:v",
    "2",
    outputPattern,
  ]);
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    child.on("error", (error) => {
      const missingTool = error?.code === "ENOENT";
      reject(new Error(missingTool ? `${command} is required but is not installed or not in PATH` : error.message));
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} failed: ${stderr.slice(-1200)}`));
    });
  });
}

async function runNodeOdmJob(scanId, imagePaths, outputDir) {
  const form = new FormData();
  form.append("name", `scan-${scanId}`);
  form.append(
    "options",
    JSON.stringify([
      { name: "feature-quality", value: "medium" },
      { name: "mesh-octree-depth", value: 10 },
      { name: "pc-quality", value: "medium" },
    ]),
  );
  for (const imagePath of imagePaths) {
    const blob = await openAsBlob(imagePath);
    form.append("images", blob, imagePath.split("/").pop());
  }

  const createResponse = await fetch(`${nodeOdmUrl}/task/new`, {
    method: "POST",
    body: form,
  });
  if (!createResponse.ok) {
    throw new Error(`NodeODM task create failed: ${await createResponse.text()}`);
  }
  const created = await createResponse.json();
  const taskId = created.uuid || created.id;
  if (!taskId) throw new Error("NodeODM did not return a task UUID");

  await prisma.scan.update({
    where: { id: scanId },
    data: { nodeOdmTaskId: String(taskId), progress: 45, reconstructionEngine: "nodeodm" },
  });

  let info = created;
  let completed = false;
  for (let attempt = 0; attempt < 720; attempt += 1) {
    await delay(5000);
    const infoResponse = await fetch(`${nodeOdmUrl}/task/${taskId}/info`);
    if (!infoResponse.ok) continue;
    info = await infoResponse.json();
    const runningProgress = typeof info.runningProgress === "number" ? info.runningProgress : info.running_progress;
    const progress = Math.min(95, 45 + Math.round(Number(runningProgress || 0) * 45));
    await prisma.scan.update({ where: { id: scanId }, data: { progress } });
    if (Number(info.status?.code || info.status) === 40) {
      completed = true;
      break;
    }
    if (Number(info.status?.code || info.status) === 30) {
      throw new Error(info.last_error || "NodeODM task failed");
    }
  }
  if (!completed) {
    throw new Error("NodeODM task timed out before completion");
  }

  const assets = info.available_assets || info.assets || [];
  const assetNames = assets.map((asset) => (typeof asset === "string" ? asset : asset?.filename || asset?.name)).filter(Boolean);
  const assetName = assetNames.includes("textured_model.zip") ? "textured_model.zip" : "all.zip";
  const zipPath = join(outputDir, assetName);
  await downloadFile(`${nodeOdmUrl}/task/${taskId}/download/${assetName}`, zipPath);
  const extracted = extractModelAsset(zipPath, outputDir);
  return {
    taskId: String(taskId),
    assetUrl: extracted.assetUrl,
    assetType: extracted.assetType,
  };
}

function extractModelAsset(zipPath, outputDir) {
  const extractedDir = join(outputDir, "model");
  const zip = new AdmZip(zipPath);
  zip.extractAllTo(extractedDir, true);
  const objPath = findFirstFile(extractedDir, /\.obj$/i);
  if (objPath) {
    return {
      assetUrl: `/${relativeStoragePath(objPath).split("/").map(encodeURIComponent).join("/")}`,
      assetType: "obj",
    };
  }
  return {
    assetUrl: `/${relativeStoragePath(zipPath).split("/").map(encodeURIComponent).join("/")}`,
    assetType: "zip",
  };
}

function findFirstFile(dir, pattern) {
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const name of readdirSync(current)) {
      const path = join(current, name);
      const entryStat = statSync(path);
      if (entryStat.isDirectory()) stack.push(path);
      else if (pattern.test(path)) return path;
    }
  }
  return null;
}

async function downloadFile(url, destination) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: ${url}`);
  await writeFile(destination, Buffer.from(await response.arrayBuffer()));
}

function relativeStoragePath(path) {
  return path.replace(`${rootDir}/`, "").replaceAll("\\", "/");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "3d-survey-api",
    nodeOdmConfigured: Boolean(nodeOdmUrl),
    storageDir: relativeStoragePath(storageDir),
  });
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

app.post("/api/scans/upload", upload.array("media", 250), async (req, res, next) => {
  try {
    const files = req.files || [];
    if (!Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: "Upload at least one image or video file" });
    }

    const scanId = randomUUID();
    const scanStoragePath = `storage/scans/${scanId}`;
    const scanDir = join(rootDir, scanStoragePath);
    const inputDir = join(scanDir, "input");
    await mkdir(inputDir, { recursive: true });

    const media = [];
    for (const file of files) {
      const safeName = file.originalname.replace(/[^\w.\-]+/g, "_");
      const destination = join(inputDir, `${Date.now()}-${safeName}`);
      await rename(file.path, destination);
      media.push({
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        path: relativeStoragePath(destination),
      });
    }
    const latitude = req.body.latitude === "" ? null : Number(req.body.latitude);
    const longitude = req.body.longitude === "" ? null : Number(req.body.longitude);
    const altitude = req.body.altitude === "" ? null : Number(req.body.altitude);
    const accuracy = req.body.accuracy === "" ? null : Number(req.body.accuracy);
    const captureMode = typeof req.body.captureMode === "string" ? req.body.captureMode : "media-upload";
    const coverage = Number(req.body.coverage);
    const scan = await prisma.scan.create({
      data: {
        id: scanId,
        frameCount: Number.isFinite(Number(req.body.frameCount)) ? Number(req.body.frameCount) : files.length,
        coverage: Number.isFinite(coverage) ? coverage : 0,
        captureMode,
        locationStatus: Number.isFinite(latitude) && Number.isFinite(longitude) ? "captured" : "manual_required",
        latitude: Number.isFinite(latitude) ? latitude : null,
        longitude: Number.isFinite(longitude) ? longitude : null,
        altitude: Number.isFinite(altitude) ? altitude : null,
        accuracy: Number.isFinite(accuracy) ? accuracy : null,
        frames: [],
        media,
        storagePath: scanStoragePath,
        reconstructionEngine: nodeOdmUrl ? "nodeodm" : "local-draft",
        summary: {
          uploadCount: files.length,
          source: typeof req.body.source === "string" ? req.body.source : "file-picker",
          durationSec: Number.isFinite(Number(req.body.durationSec)) ? Number(req.body.durationSec) : null,
        },
      },
    });
    processMediaScan(scan.id);
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
