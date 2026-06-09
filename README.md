# 3D Survey

Phone-first property survey platform with a responsive React UI, Prisma/Supabase storage, continuous camera scanning, media upload, NodeODM reconstruction, and MapLibre + Three.js map placement.

## What it does now

- Home screen with **View Scans** and **Scan a Property** options.
- Mobile-friendly continuous camera survey with blue dotted coverage mesh and automatic sharp-frame upload.
- Media upload flow for photos/videos that should be reconstructed with ODM.
- Supabase Postgres persistence through Prisma ORM.
- Local media storage under `storage/scans/{scanId}`.
- Optional NodeODM reconstruction via `NODEODM_URL`.
- Responsive shadcn-style UI for phones and desktop.
- View Scans page with MapLibre GL JS and Three.js model placement.

## Run locally

Create `.env` from `.env.example` and set `DATABASE_URL` plus `DIRECT_URL`.

```bash
npm install
npx prisma generate
npx prisma migrate deploy
npm run dev
```

Open `http://localhost:5173`.

For phone testing, serve over HTTPS or use a local tunnel because camera access usually requires HTTPS outside localhost.

The View Scans map uses MapLibre GL JS with the free OpenFreeMap style and Three.js custom layers.

The normal phone scan flow uploads auto-captured JPEG frames. The manual media uploader also converts selected videos to JPEG frames in the browser before upload, so local ODM testing through the UI does not require `ffmpeg`. Direct API uploads of raw videos still require `ffmpeg` on the backend machine.

## Database

Use Supabase pooler URLs:

- `DATABASE_URL`: transaction-mode pooler with `?pgbouncer=true`
- `DIRECT_URL`: session-mode pooler for migrations

Do not commit `.env`. If the database password contains special characters such as `@`, URL-encode them in the connection string.

## NodeODM

For a local ODM worker:

```bash
npm run nodeodm:local
```

Then set:

```env
NODEODM_URL="http://localhost:3001"
```

Verify the worker before sending scans:

```bash
npm run check:nodeodm
```

Alternative without compose:

```bash
bash scripts/start-nodeodm-local.sh
```

Local-first scan flow:

```text
Scan a Property
-> Start recording
-> app samples sharp JPEG frames while showing the blue coverage mesh
-> Survey Done uploads those JPEG frames to the backend
-> backend sends the frames to local NodeODM when NODEODM_URL is set
-> View Scans places the generated model on the MapLibre map
```

For RunPod, use the `opendronemap/nodeodm:gpu` pod image and expose port `3000/http`. See [docs/runpod-nodeodm.md](docs/runpod-nodeodm.md).

If `NODEODM_URL` is not set, uploads still complete with a draft placement model, but no real ODM asset is generated.

## Production path

Replace the browser capture adapter with one of:

- Unity AR Foundation for Android/iOS capture.
- Native iOS ARKit and Android ARCore modules.
- A React Native/Capacitor shell with native capture plugins.

The backend stores surveys in Supabase, tracks job status through `/api/scans`, accepts auto-captured camera frames or file media at `/api/scans/upload`, and returns model geometry/asset metadata from `/api/scans/:id/model`.

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

Current free third-party stack:

- OpenDroneMap / NodeODM for reconstruction.
- MapLibre GL JS for the map.
- Three.js for custom 3D model placement.
- Canvas-based draft model viewer for the local prototype.

For production, harden the prototype worker in `server/index.mjs` into a reconstruction pipeline:

- NodeODM / OpenDroneMap for photogrammetry.
- A queue worker for long-running jobs.
- Object storage for input frames and generated GLB/USDZ files.
- MapLibre custom layers for generated OBJ/3D Tiles placement.
