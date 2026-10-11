import { z } from 'zod';
import type { AppConfig, InitProgressReport, ModelRecord, MLCEngine } from '@mlc-ai/web-llm';
import type { Language } from './data';
import type { Mission } from './engine';
import {
  llmMissionPayload, modelCompositionFallback, parseModelMissionComposition,
  requiredObservationCount, type ModelMissionComposition,
} from './briefing';

const manifestSchema = z.object({
  enabled: z.boolean(),
  modelId: z.string().optional(),
  revision: z.string().regex(/^[a-f0-9]{40}$/).optional(),
  modelUrl: z.string().optional(),
  modelLibUrl: z.string().optional(),
  modelSizeBytes: z.number().positive().optional(),
  license: z.literal('Apache-2.0').optional(),
  integrity: z.object({
    config: z.string().startsWith('sha256-'),
    model_lib: z.string().startsWith('sha256-'),
    tokenizer: z.record(z.string().startsWith('sha256-')),
    onFailure: z.literal('error'),
  }).optional(),
  message: z.string().optional(),
});

export type LocalModelManifest = z.infer<typeof manifestSchema>;
export type ModelProgress = { text: string; progress: number };

let engine: MLCEngine | null = null;
let loadedManifest: LocalModelManifest | null = null;

const MODEL_ID = 'SmolLM2-360M-Instruct-q4f16_1-MLC';
const MODEL_REVISION = '3a622fd89e0216e8bb10c410c007c786baa8a033';
const MODEL_URL = `https://huggingface.co/mlc-ai/${MODEL_ID}/resolve/${MODEL_REVISION}/`;
const MODEL_LIB_URL = 'https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/025bcaf3780fa8254f5e5efd3bfea0a5397248f4/web-llm-models/v0_2_84/base/SmolLM2-360M-Instruct-q4f16_1_cs1k-webgpu.wasm';

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.ceil(bytes / 1024 ** 2)} MB`;
}

export async function readLocalModelManifest(): Promise<LocalModelManifest> {
  const response = await fetch('/model-manifest.json', { credentials: 'same-origin', cache: 'no-cache' });
  if (!response.ok) throw new Error(`Could not read the local model manifest (${response.status}).`);
  return manifestSchema.parse(await response.json());
}

function checkedRecord(manifest: LocalModelManifest, prebuilt: ModelRecord[]): ModelRecord {
  if (
    !manifest.enabled ||
    !manifest.modelId ||
    !manifest.revision ||
    !manifest.modelUrl ||
    !manifest.modelLibUrl ||
    !manifest.modelSizeBytes ||
    manifest.license !== 'Apache-2.0' ||
    !manifest.integrity
  ) {
    throw new Error(manifest.message ?? 'The reviewed local model is not available.');
  }
  if (
    manifest.modelId !== MODEL_ID ||
    manifest.revision !== MODEL_REVISION ||
    manifest.modelUrl !== MODEL_URL ||
    manifest.modelLibUrl !== MODEL_LIB_URL
  ) {
    throw new Error('The model manifest does not match the reviewed, pinned model release.');
  }
  const compatible = prebuilt.find((entry) => entry.model_id === MODEL_ID);
  if (!compatible) throw new Error('The packaged model is incompatible with the bundled WebLLM runtime.');
  return { ...compatible, model: MODEL_URL, model_lib: MODEL_LIB_URL, integrity: manifest.integrity };
}

export async function modelRequirements(): Promise<{ supported: boolean; reason: string }> {
  const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if (typeof deviceMemory === 'number' && deviceMemory < 4) {
    return { supported: false, reason: 'This device reports less than 4 GB of memory.' };
  }
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
  if (!gpu || !(await gpu.requestAdapter())) {
    return { supported: false, reason: 'WebGPU is not available on this device.' };
  }
  if (!navigator.storage?.estimate) {
    return { supported: false, reason: 'Browser storage quota cannot be checked on this device.' };
  }
  const { quota = 0 } = await navigator.storage.estimate();
  if (quota < 2 * 1024 ** 3) {
    return { supported: false, reason: 'This device has less than 2 GB of browser storage quota.' };
  }
  return { supported: true, reason: '' };
}

export async function requestModelStoragePersistence(): Promise<boolean> {
  return navigator.storage?.persist ? navigator.storage.persist() : false;
}

export async function loadLocalModel(
  onProgress: (progress: ModelProgress) => void,
): Promise<LocalModelManifest> {
  const requirements = await modelRequirements();
  if (!requirements.supported) throw new Error(requirements.reason);
  const manifest = await readLocalModelManifest();
  const { CreateMLCEngine, prebuiltAppConfig } = await import('@mlc-ai/web-llm');
  const record = checkedRecord(manifest, prebuiltAppConfig.model_list);
  const persistent = await requestModelStoragePersistence();
  if (!persistent) {
    onProgress({
      text: 'Persistent storage was not granted; the browser may clear the downloaded model cache.',
      progress: 0,
    });
  }
  const modelAppConfig: AppConfig = { model_list: [record], cacheBackend: 'cache' };
  engine = await CreateMLCEngine(manifest.modelId!, {
    appConfig: modelAppConfig,
    initProgressCallback: (report: InitProgressReport) => onProgress({
      text: report.text,
      progress: report.progress,
    }),
  });
  loadedManifest = manifest;
  return manifest;
}

export async function composeLocalMission(
  mission: Mission,
  language: Language,
  onProgress: (progress: ModelProgress) => void,
): Promise<{ composition: ModelMissionComposition; manifest: LocalModelManifest }> {
  if (language !== 'en') throw new Error('Local mission composition is currently English-only; the translated template remains available.');
  if (mission.safety) throw new Error('The app is applying the mission safety guidance. Keep using the template note.');
  const candidates = [...mission.targets, ...mission.gems];
  if (candidates.length <= requiredObservationCount(mission)) {
    throw new Error('There are not enough supported observations for a primary mission and an alternative. Keep using the template note.');
  }
  const manifest = loadedManifest ?? await loadLocalModel(onProgress);
  if (!engine) throw new Error('The local model did not finish loading.');
  const context = llmMissionPayload(mission);
  const candidateIds = candidates.map(({ id }) => id);
  const stepCount = requiredObservationCount(mission);
  const responseSchema = {
    type: 'object',
    properties: {
      objective: { type: 'string' },
      stepIds: {
        type: 'array',
        items: { type: 'string', enum: candidateIds },
        minItems: stepCount,
        maxItems: stepCount,
        uniqueItems: true,
      },
    },
    required: ['objective', 'stepIds'],
    additionalProperties: false,
  };
  const generate = async (correction: string) => {
    const result = await engine!.chat.completions.create({
      messages: [
        {
          role: 'system',
          content: `Compose a curious outdoor mission, not a generic description. Return exactly one JSON object with objective and stepIds. objective must be an imperative phrase of 4 to 16 words starting with Notice, Observe, Compare, Explore, Discover, Look, Listen, Trace, or Watch. The current season is ${mission.season}; never name a different season. Connect season or weather to details explicitly supported by the habitat or observation clues. Do not name species, invent habitats or animal behaviour, or use the phrases "nature mission", "presence of a specific species", or "record". stepIds contains the requested number of distinct IDs from the supplied candidates only. The app chooses a fallback observation. Example grounded objective for this outing: {"objective":"Notice small details around you in ${mission.season}","stepIds":["candidate-a"]}. Do not add text outside the JSON object.`,
        },
        {
          role: 'user',
          content: `${correction}Mission context:\n${context}\nReturn exactly ${stepCount} distinct step IDs.`,
        },
      ],
      response_format: { type: 'json_object', schema: JSON.stringify(responseSchema) },
      temperature: 0.3,
      max_tokens: 256,
    });
    const choice = result.choices[0];
    if (choice?.finish_reason === 'length') {
      throw new Error('The local model output was truncated. Keep using the template note.');
    }
    return choice?.message.content ?? '';
  };
  let parsed = parseModelMissionComposition(await generate(''), mission);
  let issue = parsed.issue;
  if (issue) {
    parsed = parseModelMissionComposition(
      await generate(`The previous response was rejected: ${issue}. Return only the required valid JSON object.`),
      mission,
    );
    issue = parsed.issue;
  }
  if (issue || !parsed.composition) throw new Error(modelCompositionFallback(`${issue ?? 'did not produce a valid mission'} twice`));
  return {
    composition: parsed.composition,
    manifest,
  };
}

export async function deleteLocalModel(): Promise<void> {
  const manifest = loadedManifest ?? await readLocalModelManifest();
  if (!manifest.enabled || !manifest.modelId) throw new Error('No packaged local model is available to delete.');
  if (engine) {
    await engine.unload();
    engine = null;
  }
  const { deleteModelAllInfoInCache, prebuiltAppConfig } = await import('@mlc-ai/web-llm');
  const record = checkedRecord(manifest, prebuiltAppConfig.model_list);
  await deleteModelAllInfoInCache(manifest.modelId, { model_list: [record], cacheBackend: 'cache' });
  loadedManifest = null;
}

export function localModelIsLoaded(): boolean {
  return Boolean(engine && loadedManifest);
}
