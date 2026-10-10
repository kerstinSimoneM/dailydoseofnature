import { z } from 'zod';
import type { AppConfig, InitProgressReport, ModelRecord, MLCEngine } from '@mlc-ai/web-llm';
import type { Language } from './data';
import type { Mission } from './engine';
import { llmMissionPayload, substituteBriefing, validateBriefing } from './briefing';

const manifestSchema = z.object({
  enabled: z.boolean(),
  modelId: z.string().optional(),
  revision: z.string().regex(/^[a-f0-9]{40}$/).optional(),
  modelUrl: z.string().optional(),
  modelLibUrl: z.string().optional(),
  modelSizeBytes: z.number().positive().optional(),
  modelSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  files: z.record(z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/), sizeBytes: z.number().nonnegative() })).optional(),
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

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.ceil(bytes / 1024 ** 2)} MB`;
}

function sameOriginPath(path: string): string {
  const url = new URL(path, window.location.origin);
  if (url.origin !== window.location.origin || !url.pathname.startsWith('/models/')) {
    throw new Error('Model artifacts must be hosted on this app’s own origin.');
  }
  return url.href;
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
    !manifest.integrity
  ) {
    throw new Error(manifest.message ?? 'A signed-off, first-party model pack is not available.');
  }
  const compatible = prebuilt.find((entry) => entry.model_id === manifest.modelId);
  if (!compatible) throw new Error('The packaged model is incompatible with the bundled WebLLM runtime.');
  const model = sameOriginPath(manifest.modelUrl);
  const modelLib = sameOriginPath(manifest.modelLibUrl);
  if (!model.includes(`/resolve/${manifest.revision}/`)) {
    throw new Error('The model URL does not match its pinned source revision.');
  }
  if (!manifest.modelSha256 || !manifest.files || Object.keys(manifest.files).length === 0) {
    throw new Error('The model pack has no complete SHA-256 file manifest.');
  }
  return { ...compatible, model, model_lib: modelLib, integrity: manifest.integrity };
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
  if (!navigator.storage?.estimate || !navigator.storage?.persist) {
    return { supported: false, reason: 'Persistent browser storage is not available.' };
  }
  const { quota = 0 } = await navigator.storage.estimate();
  if (quota < 2 * 1024 ** 3) {
    return { supported: false, reason: 'This device has less than 2 GB of browser storage quota.' };
  }
  return { supported: true, reason: '' };
}

export async function loadLocalModel(
  onProgress: (progress: ModelProgress) => void,
): Promise<LocalModelManifest> {
  const requirements = await modelRequirements();
  if (!requirements.supported) throw new Error(requirements.reason);
  const manifest = await readLocalModelManifest();
  const { CreateMLCEngine, prebuiltAppConfig } = await import('@mlc-ai/web-llm');
  const record = checkedRecord(manifest, prebuiltAppConfig.model_list);
  const persistent = await navigator.storage.persist();
  if (!persistent) throw new Error('The browser did not grant persistent storage for the optional model.');
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

export async function rewriteMissionBriefing(
  mission: Mission,
  distance: string,
  direction: string,
  language: Language,
  onProgress: (progress: ModelProgress) => void,
): Promise<{ text: string; manifest: LocalModelManifest }> {
  if (language !== 'en') throw new Error('Local story rewrites are currently English-only; the translated template remains available.');
  const manifest = loadedManifest ?? await loadLocalModel(onProgress);
  if (!engine) throw new Error('The local model did not finish loading.');
  const safeMission = llmMissionPayload(mission);
  const systemPrompt = [
    'Rewrite the supplied mission plan as a warm, factual nature invitation in English.',
    'Return 120 words or fewer. Use placeholders exactly as supplied; never write species names or numbers.',
    'Include {{species:ID}} for an available target, plus {{dist}}, {{walk_min}}, and {{dir}}.',
    'Include the exact sentence: "Put your phone away and notice the world around you."',
    'Do not invent facts, encourage leaving paths, or add safety claims.',
    'Return only the briefing text.',
  ].join(' ');
  const generate = async (temperature: number) => {
    const result = await engine!.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: safeMission },
      ],
      temperature,
      max_tokens: 180,
    });
    return result.choices[0]?.message.content?.trim() ?? '';
  };
  let draft = await generate(0.5);
  if (!validateBriefing(draft, mission)) draft = await generate(0.15);
  if (!validateBriefing(draft, mission)) {
    throw new Error('The local model could not produce a valid short briefing. Keep using the template note.');
  }
  return {
    text: substituteBriefing(draft, mission, distance, direction),
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
