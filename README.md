# SiteMapper Scan

Dependency-free prototype for a cross-platform property scanning system.

## What it does now

- Runs in a browser on desktop, Android, or iPhone.
- Opens the rear camera when available.
- Samples camera frames automatically while the user moves.
- Shows a blue dotted coverage mesh over the live camera feed.
- Captures browser geolocation for approximate map placement.
- Uploads scan packages to a local backend.
- Runs a backend draft reconstruction worker.
- Returns draft model placement metadata for map overlay.
- Shows a draggable 3D property model viewer.
- Exports a `scan-package.json` metadata file.

## Run locally

```bash
python3 server.py
```

Open `http://localhost:4173`.

For phone testing, serve over HTTPS or use a local tunnel because camera access usually requires HTTPS outside localhost.

## Production path

Replace the browser capture adapter with one of:

- Unity AR Foundation for Android/iOS capture.
- Native iOS ARKit and Android ARCore modules.
- A React Native/Capacitor shell with native capture plugins.

The current backend stores surveys in `data/scans`, tracks job status through `/api/scans`, and returns draft model geometry plus placement metadata from `/api/scans/:id/model`.

The scan payload includes:

- `captureMode: "continuous-survey"`
- sampled `frames`
- `coverageMap`
- optional `location`
- `locationStatus`

The generated model includes:

- draft mesh vertices/faces
- dimensions
- `placement` with latitude, longitude, altitude, rotation, scale, and accuracy label

For production, replace the draft worker in `server.py` with a reconstruction pipeline:

- COLMAP or Meshroom for photogrammetry.
- Open3D for point-cloud/depth reconstruction.
- A queue worker for long-running jobs.
- Object storage for input frames and generated GLB/USDZ files.
- CesiumJS or Google Maps WebGL Overlay for real 3D map placement.
