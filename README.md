# Daily Dose of Nature

A phone-first PWA that turns local nature observations into a small, achievable reason to go outside. Missions work without an account or AI model; the app has no backend, analytics, or tracking. Source code is MIT-licensed (see [LICENSE](./LICENSE)).

## Hacktoberfest Week 1

Submissions are due **October 11 at 11:59 PM PDT** (October 12 at 06:59 UTC / 08:59 in Berlin). See the [official challenge post](https://dev.to/devteam/join-the-hacktoberfest-open-source-ai-challenge-week-1-touch-grass-2450-in-prizes-across-17-4pom) for submission instructions.

## Deploy

Render is a good fit: this is a static Vite PWA, so it needs no application server. Create a **Static Site** connected to the repository, use build command `npm ci && npm run build`, and publish directory `dist`. Render provides HTTPS and can create pull-request previews. A deployed demo is useful for the challenge submission; Render is an option, not a contest requirement.

## Run and test

Requires Node.js 20.19+ or 22.12+.

```sh
npm install
npm run dev
npm test
npm run test:e2e
npm run build
```

## How it works

The app ranks candidate species and destinations from locally available data, season, outing duration, and weather-related safety rules. Suggestions summarize submitted observations; they are not live sightings, abundance estimates, calibrated probabilities, or guarantees that a species is present. The 28-area picker is schematic, destinations are curated points, and the app does not provide route navigation.

The optional Berlin observational pilot is built from filtered GBIF/iNaturalist records ([dataset DOI](https://doi.org/10.15468/ab3s5x)). To refresh it, install `pipeline/requirements.txt`, then run `npm run pilot-pack`. The deployed app uses the generated same-origin pack and does not contact GBIF. The pilot contains aggregate patterns, not exact occurrence coordinates. Citizen-science coverage is uneven, so rankings and coarse areas can be biased or share evidence.

To prepare supplied species photos, run `python3 -m pipeline.prepare_species_images`. Images and occurrence data retain their source licensing and attribution; see the pipeline configuration and metadata for details. The optional strict GBIF/OSM release pipeline requires separately supplied, licensed inputs and curated sensitive-species lists; it is not the same as the observational pilot.

## Privacy and offline use

Location is requested only when the user chooses “Use my location.” The app uses the browser-provided position in memory for local ranking; application code does not transmit, log, or persist it. The Berlin forecast always uses the fixed Berlin centre, not the user's location. Weather comes from Open-Meteo and may be cached locally; checklist entries store only a species ID and date.

The app shell and nature pack can be cached for offline use. Species images are cached as viewed. The optional model is cached only after the user chooses to try it, and requires a compatible WebGPU device and sufficient browser storage.

## On-device AI: current limitations

Touch Grass includes an experimental integration with an open-weight language model running on-device. It can choose from valid local mission candidates and generate an objective, but initial browser testing did not show a meaningful improvement over the handcrafted baseline. Objectives did not adapt reliably to outing duration or establish supported biological relationships between observations.

The current dataset has 30,850 observations across 230 taxa, but empty habitat fields and limited diversity in English observation clues constrain useful synthesis. Deterministic mission generation therefore remains the default; AI is optional and is not required to use the app.

A future version could revisit AI missions with richer, well-sourced habitat, seasonal, and ecological-relationship data. It should evaluate them against the deterministic baseline for biological grounding, mission quality, and actual user motivation—not just valid model output.

The optional English-only experiment uses [SmolLM2-360M-Instruct](https://huggingface.co/mlc-ai/SmolLM2-360M-Instruct-q4f16_1-MLC/tree/3a622fd89e0216e8bb10c410c007c786baa8a033) (Apache-2.0) through [WebLLM](https://github.com/mlc-ai/web-llm) and MLC-LLM (Apache-2.0). On first use it downloads about 200 MB; generation runs locally. The app sends the model only a season, weather category, time budget, coarse habitat, and candidate IDs/clues—no coordinates or destination names. Output is validated against supplied candidates, and the deterministic mission remains available if generation fails. The model cannot override safety guidance. `public/model-manifest.json` records pinned revisions and integrity metadata.

## Data and other licences

The app source is MIT. The model and WebLLM/MLC-LLM software are Apache-2.0. The pilot accepts CC0 and CC BY 4.0 occurrence records; Open-Meteo is CC BY 4.0; OpenStreetMap data is ODbL. Keep data and image attribution with redistributed material. App licensing does not replace the licences of data or model assets.
