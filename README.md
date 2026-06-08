# 3D Survey

Phone-first property survey platform with a responsive React UI, Prisma/Supabase storage, continuous camera scanning, draft 3D model generation, and CesiumJS map placement.

## What it does now

- Home screen with **View Scans** and **Scan a Property** options.
- Mobile-friendly continuous camera survey with blue dotted coverage mesh.
- Supabase Postgres persistence through Prisma ORM.
- Draft backend model generation with map placement metadata.
- Responsive shadcn-style UI for phones and desktop.
- View Scans page with CesiumJS 3D map placement using OpenStreetMap tiles.

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

The Map tab loads CesiumJS from jsDelivr and uses OpenStreetMap imagery, so internet access is required for the map library and tiles.

## Database

Use Supabase pooler URLs:

- `DATABASE_URL`: transaction-mode pooler with `?pgbouncer=true`
- `DIRECT_URL`: session-mode pooler for migrations

Do not commit `.env`. If the database password contains special characters such as `@`, URL-encode them in the connection string.

## Production path

Replace the browser capture adapter with one of:

- Unity AR Foundation for Android/iOS capture.
- Native iOS ARKit and Android ARCore modules.
- A React Native/Capacitor shell with native capture plugins.

The backend stores surveys in Supabase, tracks job status through `/api/scans`, and returns draft model geometry plus placement metadata from `/api/scans/:id/model`.

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

- CesiumJS for 3D map placement.
- OpenStreetMap tiles for the basemap.
- Canvas-based draft model viewer for the local prototype.

For production, replace the draft worker in `server.py` with a reconstruction pipeline:

- COLMAP or Meshroom for photogrammetry.
- Open3D for point-cloud/depth reconstruction.
- A queue worker for long-running jobs.
- Object storage for input frames and generated GLB/USDZ files.
- CesiumJS 3D Tiles rendering for real georeferenced model streaming.
