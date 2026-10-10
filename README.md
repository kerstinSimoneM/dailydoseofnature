# Daily Dose of Nature

A phone-first, template-led nature mission PWA. The app has no backend, account, analytics, tracking, external maps, or map tiles.

## Run locally

Use Node.js 20 or newer:

```sh
npm install
npm run dev
```

Production build and tests:

```sh
npm test
npm run build
python3 -m unittest discover -s pipeline -p 'test_*.py'
npm audit
```

The production HTTPS deployment can be installed as a PWA. The application shell is precached. A Berlin data pack is loaded same-origin and cached for later offline use; the optional WebLLM runtime is split from the shell and cached only when requested.

## Privacy and weather

- Geolocation is a one-time browser fix. When permission is granted, the browser provides coordinates to this page; the app code uses them in memory for local ranking and does not send, log, or save them. This describes the app code, not how the browser or operating system determines or processes location.
- “Use my location” requires a secure context (HTTPS or localhost) and browser permission. Permission denial, unavailable device services, timeout, and low-accuracy fixes produce separate guidance; fixes up to 1 km accuracy are accepted and shown as approximate.
- The Berlin forecast request always uses the fixed coordinates `52.520, 13.405`, regardless of the user's selected area or GPS fix. The current forecast hour is displayed separately from the forecast bucket for the selected outing duration; the latter can change when the duration changes because it covers a different span of forecast hours. Open-Meteo returns a three-day forecast; valid responses are cached on-device for up to three hours, with stale cached data clearly marked.
- No forecast coordinates are included in local storage. Weather is fetched from `api.open-meteo.com`; the Content Security Policy allowlists that host and the app's own origin only.
- Checklist records contain only a species ID and date. The offline area picker is a small schematic, not a remote map.

## Berlin observational pilot

Build the pilot snapshot from GBIF's public occurrence API (network required during this build only):

```sh
python3 -m pip install -r pipeline/requirements.txt
npm run pilot-pack
npm test
npm run build
```

The builder queries a fixed Berlin-wide polygon and 2023-to-build-date event window; it never uses or uploads browser location. It requests only human observations from the iNaturalist Research-grade dataset (`50c9509d-22c7-4a22-a47d-8c48425ef4a7`, [dataset DOI](https://doi.org/10.15468/ab3s5x)) licensed CC0 or CC BY 4.0. It rejects records without a valid species, date, or coordinate uncertainty of at most 1 km, excludes taxa GBIF marks Vulnerable/Endangered/Critically Endangered, and publishes a taxon only with at least 30 accepted records across 5 coarse H3 resolution-6 cells and 3 years. The generated same-origin `public/data/berlin-pack.json` contains aggregate counts and grid identifiers, not occurrence coordinates or individual record keys.

The app uses coarse observation patterns around the selected area and duration-dependent destination, plus reported-month patterns, as ranking signals. The 28-area picker is an approximate grid over a schematic map, not official Berlin district boundaries; its observation evidence is aggregated to coarser H3 resolution-6 cells, so adjacent areas may share evidence. Outing time is a total budget: estimated round-trip walking plus noticing time. Destination distance is one-way and uses a conservative straight-line detour estimate; if no curated destination fits the walking budget, the mission stays at the starting area. Destinations remain hand-curated points; this pilot does not include verified OSM paths, live access checks, or route navigation. Weather still informs outing safety, but does not change species rankings: this source snapshot does not provide defensible weather- or time-of-day-linked observation effort. Suggestions are summaries of submitted observations—not live sightings, calibrated probabilities, abundance estimates, or confirmation that a species is present today. Citizen-science coverage is uneven, and the coarse-grid and support thresholds reduce identifiability but do not replace expert sensitivity review.

Species common names come from GBIF vernacular-name records. The app prefers the selected interface language; when that name is unavailable it uses an available common name and labels its language. If GBIF provides no common name, the scientific name is shown with an explicit note.

GBIF provides individual record licences. The published pack contains no images and only accepts CC0 / CC BY 4.0 occurrence records; it records the source dataset citation and build/query metadata. Re-run `npm run pilot-pack` to refresh the static snapshot; the deployed app itself does not contact GBIF.

## Strict GBIF / OSM release pipeline

The separate strict release pipeline reads files supplied locally; it does not query Geofabrik or weather services on a user's behalf. Its held-out ranking test remains a ranking gate, not a probability calibration study.

Before a strict release build, review `pipeline/sources.yaml` and verify `observations.dataset_key`. Curate both `pipeline/sensitive.yaml` and `pipeline/identifiability.yaml`; release builds fail if either list is empty. Never add sensitive species based on popularity or public-coordinate availability.

Prepare these inputs:

1. Official training and separate held-out GBIF Darwin Core Archive ZIP downloads. Each must contain `occurrence.txt` and a `citation.txt` download DOI. Configure the expected dataset key; records from a different or missing `datasetKey` are rejected. The training DOI must match the archive citation.
2. A Berlin boundary polygon GeoJSON.
3. A Geofabrik-derived OSM GeoJSON with public green-space polygons and intersecting walkable paths. Keep OSM attribution and comply with ODbL/share-alike requirements.
4. An Open-Meteo historical JSON archive at the fixed Berlin centre with the hourly temperature, precipitation, snowfall, weather code, and cloud-cover fields used by the pipeline.

Build from the repository root:

```sh
python3 -m pipeline.build_pack \
  --training /path/to/training.zip \
  --held-out /path/to/held-out.zip \
  --boundary /path/to/berlin-boundary.geojson \
  --osm /path/to/berlin-green-spaces.geojson \
  --weather /path/to/berlin-weather.json \
  --doi https://doi.org/your-training-download-doi \
  --output public/data/berlin-pack.json \
  --maximum-dropped-share 0.5
```

The release gate filters invalid, generalized, sensitive, cultivated, stale, and imprecise records; excludes sensitive coordinates from all spatial aggregation; retains licensed image attribution; computes H3 effort-normalized rates and smoothed temporal lifts; selects curated group/season quotas; and snaps public green anchors to walkable OSM paths. It requires a strictly later held-out window of at most 60 days, 1,000 unique held-out cell/month/species scenarios, and a top-three ranking hit rate above both raw-cell and random-active baselines. A failing or incomplete build does not publish a usable pack.

The app validates `public/data/berlin-pack.json` before using it. Schema 2 is explicitly marked as an observational pilot and is not run through or presented as the schema-1 strict release gate. If no pilot pack is present, the app keeps the starter guide visibly labelled as illustrative. No production pack or calibration claim is possible until real licensed inputs, curated taxon lists, and independent validation are supplied and pass the strict release gate.

## On-device story helper

The template briefing works immediately and needs no model. An optional WebLLM path accepts only sanitized mission text (no coordinates or species names), validates the generated placeholders, and keeps generation on-device. Model downloads are disabled by default: no model weights or model license are included.

After reviewing a compatible MLC model, its license, source revision, and runtime compatibility, package it with:

```sh
python3 -m pipeline.prepare_model \
  --model-dir /path/to/reviewed-mlc-model \
  --model-lib /path/to/compatible-model-library.wasm \
  --model-id SmolLM2-360M-Instruct-q4f16_1-MLC \
  --revision FULL_40_CHARACTER_COMMIT
```

The packager writes immutable same-origin model paths, file hashes, and the manifest used by the app. Do not enable or ship an unreviewed model package. WebGPU and persistent storage are required; the translated template remains available on unsupported devices.

## Data and licences

The hand-written guide is sample content, not occurrence evidence. The optional pilot pack instead ranks filtered GBIF observations by coarse cell and reported month; it does not estimate abundance or probability, and contains no precise occurrence coordinates. GBIF/DwC-A and image licences must be preserved and attributed; the strict pipeline only packages images with supported redistribution licences. Open-Meteo data is CC BY 4.0. OpenStreetMap / Geofabrik data is ODbL and requires attribution and applicable share-alike compliance. The application source is MIT-licensed (see [LICENSE](./LICENSE)); that licence does not replace data or model licences.

## Known limitations

Observer bias shapes opportunistic sightings; a relative ranking is not a guarantee of presence. The observational pilot is a static query snapshot; known-threatened taxa and poorly supported taxa are suppressed, but expert taxon curation is still needed for a production release. The strict release pipeline requires curated lists and local inputs. The app has no route graph, live access/lighting validation, offline WASM model fallback, or device-matrix certification. Held-out ranking improvement does not establish calibrated probabilities or ecological truth.

## I took it outside

```text
Date:
Area (not exact coordinates):
Duration:
Weather:
One thing I noticed:
What surprised me:
What I would change next time:
```

## Licence

MIT. See [LICENSE](./LICENSE).
