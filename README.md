# Daily Dose of Nature

A phone-first, template-led nature mission PWA prototype. The interface, bundled guide, area picker, mission planner and field notes work without a backend; a user location is kept in memory only.

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
```

The app can be installed from a production HTTPS deployment. Vite PWA precaches the application shell and bundled static files. The Content Security Policy only permits same-origin connections; this prototype does not make weather, map, analytics, telemetry, or species-data requests.

## Privacy and offline behavior

- No backend, tracking, analytics, external maps, or map tiles.
- The optional geolocation call is a one-time browser fix. Coordinates and the in-memory H3 cell are used only on-device and are not persisted or transmitted.
- The offline Berlin area picker uses a small bundled schematic, not a server map.
- The field-notes storage shape is limited to species IDs and dates.
- Weather is a user-selected local scenario in this prototype. The fixed-coordinate Open-Meteo forecast integration is not implemented.
- Offline caching becomes available after the production app is first loaded; the demo development server does not register the service worker.

## Why open matters

Open data and open source make the intended product useful offline in a park with no signal, keep a person's location private, allow model/data sources to be swapped, and avoid zero-value server running costs. This prototype demonstrates the privacy and offline-first shape, but does not yet include a GBIF-derived data pack or a downloaded open-weight model.

## Data and licences

This repository includes only hand-written starter species tips and local emoji illustrations. They are explicitly illustrative and do not claim that a species was observed at a particular park.

A production release must build from a GBIF occurrence download of iNaturalist research-grade observations, retain the GBIF download DOI, preserve every observation's licence, and cite the per-record iNaturalist/GBIF licences. Open-Meteo data is CC BY 4.0. OpenStreetMap / Geofabrik data is ODbL; every derived pack must carry OSM attribution and comply with share-alike obligations. The application source is MIT-licensed (see [LICENSE](./LICENSE)); that does not change data licences.

## Known limitations

Observer bias affects every opportunistic-sightings dataset. A relative likelihood is not a guarantee that an organism is present. Data age must be visible and considered. This starter pack has no occurrence data, effort-normalized rates, seasonal calibration, image corpus, or location-specific evidence. Anchors, access, lighting and habitat labels are illustrative and are not live-verified. The demo does not yet meet the data-backed likelihood, backtest, diversity, detailed weather safety, downloaded model, or device-matrix requirements of the full product brief.

The release data pipeline still needs the Berlin boundary, actual GBIF download workflow and DOI storage, Open-Meteo fixed-centre archive, Geofabrik processing, H3 aggregation, curated sensitive/identifiability taxon lists, image licensing, seasonal/group quotas, quality report, and held-out calibration. Do not describe this starter pack as a production biodiversity recommendation.

## On-device story helper

The immediate briefing is a local template and needs no model. WebLLM / wllama integration is not enabled in this prototype. Before enabling it, pin and checksum a model hosted under project control, document its size and quality rubric, gate on device/storage capabilities, persist model storage with consent, validate placeholders, and test that only the mission plan reaches the local model.

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
