import { config } from "./config.js";

// Council "seats" are explicit, role-typed reviewer identities layered ON TOP of the 4 base
// providers. They do not change the existing ask_${provider} routing. Local seats are backed by
// Ollama with a per-seat model override; cloud seats by an OpenAI-compatible endpoint.
export type SeatId =
  | "qwen"
  | "llama_fast"
  | "deepseek"
  | "gemini"
  | "groq"
  | "cerebras"
  | "mistral"
  | "openrouter"
  | "glm"
  | "nvidia";
export type SeatLocality = "local" | "cloud";
export type CouncilMode = "quick" | "private" | "coding";
export type Sensitivity = "normal" | "private";

export type Seat = {
  id: SeatId;
  title: string;
  role: string; // role-specific framing injected into the seat prompt
  locality: SeatLocality;
  inDefaultCouncil: boolean; // DeepSeek is false — manual-only, never auto-loaded
};

export const SEATS: Record<SeatId, Seat> = {
  qwen: {
    id: "qwen",
    title: "Qwen 30B (local)",
    role: "Local private reviewer, Cantonese/Chinese-aware. Brainstorm and find what is missing.",
    locality: "local",
    inDefaultCouncil: true,
  },
  llama_fast: {
    id: "llama_fast",
    // Stable id kept as "llama_fast" for back-compat, but the backing model is now qwen3:8b
    // (config.ollama.fastModel) — keep the id stable for back-compat even if the backing model changes.
    title: "Fast local sanity (Qwen3 8B)",
    role: "Fast sanity checker. Catch obvious contradictions and the single biggest hole.",
    locality: "local",
    inDefaultCouncil: true,
  },
  deepseek: {
    id: "deepseek",
    title: "DeepSeek R1 70B (local, heavy)",
    role: "Heavy deep reasoner. MANUAL-ONLY — never part of a default council.",
    locality: "local",
    inDefaultCouncil: false,
  },
  gemini: {
    id: "gemini",
    title: "Gemini (cloud)",
    role: "Fast external critic. Attack assumptions and propose a simpler alternative.",
    locality: "cloud",
    inDefaultCouncil: true,
  },
  groq: {
    id: "groq",
    title: "Groq (cloud, fast)",
    role: "High-speed external sanity check and independent second opinion.",
    locality: "cloud",
    inDefaultCouncil: true,
  },
  cerebras: {
    id: "cerebras",
    title: "Cerebras (cloud, fast)",
    role: "High-speed code/logic sanity check and model comparison.",
    locality: "cloud",
    inDefaultCouncil: true,
  },
  mistral: {
    id: "mistral",
    title: "Mistral (cloud, free mode)",
    role: "European/open-model critic. Good for writing, coding sanity, and a different cultural/model-family perspective.",
    locality: "cloud",
    inDefaultCouncil: true,
  },
  openrouter: {
    id: "openrouter",
    title: "OpenRouter Free Llama (cloud, experimental)",
    role:
      "Free-model-pool external critic via OpenRouter. Good for occasional extra disagreement and broad sanity checks; rate-limited and not for private data.",
    locality: "cloud",
    inDefaultCouncil: true,
  },
  glm: {
    id: "glm",
    title: "GLM-5.2 (cloud, architect)",
    role: "Long-horizon coding/architecture reviewer. Find structural risks and rollback gaps.",
    locality: "cloud",
    inDefaultCouncil: true,
  },
  nvidia: {
    id: "nvidia",
    title: "NVIDIA NIM (cloud, free)",
    role:
      "Free NVIDIA-hosted open-model critic (Llama/Mistral/Qwen/DeepSeek on NVIDIA's GPUs). Broad-catalog external second opinion; OpenAI-compatible, rate-limited, NOT for private data.",
    locality: "cloud",
    inDefaultCouncil: true,
  },
};

// Presets never list DeepSeek. quick = everyday 'is this dumb?' and must stay workstation-friendly:
// prefer free/fast cloud critics plus the small fast local seat (llama_fast = qwen3:8b), not Qwen 30B. private keeps
// Qwen available for sensitive drafts when the user explicitly asks for deeper local review.
// coding = hub architecture/debug (may include the paid GLM seat when configured).
const PRESETS: Record<CouncilMode, SeatId[]> = {
  quick: ["gemini", "cerebras", "mistral", "llama_fast", "nvidia", "groq"],
  private: ["llama_fast", "qwen"],
  coding: ["gemini", "glm", "qwen", "cerebras"],
};

export function seatModel(id: SeatId): string {
  switch (id) {
    case "qwen":
      return config.ollama.model;
    case "llama_fast":
      return config.ollama.fastModel;
    case "deepseek":
      return config.ollama.deepseekModel;
    case "gemini":
      return config.gemini.model;
    case "groq":
      return config.groq.model;
    case "cerebras":
      return config.cerebras.model;
    case "mistral":
      return config.mistral.model;
    case "openrouter":
      return config.openrouter.model;
    case "glm":
      return config.glm.model;
    case "nvidia":
      return config.nvidia.model;
  }
}

export function seatConfigured(id: SeatId): boolean {
  switch (id) {
    case "qwen":
    case "llama_fast":
    case "deepseek":
      return Boolean(config.ollama.endpoint && seatModel(id));
    case "gemini":
      return Boolean(config.gemini.apiKey);
    case "groq":
      return Boolean(config.groq.apiKey);
    case "cerebras":
      return Boolean(config.cerebras.apiKey);
    case "mistral":
      return Boolean(config.mistral.apiKey);
    case "openrouter":
      return Boolean(config.openrouter.apiKey);
    case "glm":
      return Boolean(config.glm.apiKey);
    case "nvidia":
      return Boolean(config.nvidia.apiKey);
  }
}

export function configuredSeats(): Record<SeatId, boolean> {
  const out = {} as Record<SeatId, boolean>;
  for (const id of Object.keys(SEATS) as SeatId[]) out[id] = seatConfigured(id);
  return out;
}

export type SeatSelection = {
  seats: SeatId[];
  dropped: Array<{ id: SeatId; reason: string }>;
};

// Build the council roster: start from the preset, then drop manual-only (DeepSeek), drop cloud seats
// for a private task, drop unconfigured seats, and cap at the seat budget. Pure + deterministic.
export function selectSeats(
  mode: CouncilMode,
  sensitivity: Sensitivity,
  maxSeats: number = config.council.maxSeats,
): SeatSelection {
  const dropped: SeatSelection["dropped"] = [];
  const seats: SeatId[] = [];
  for (const id of PRESETS[mode]) {
    const seat = SEATS[id];
    if (!seat.inDefaultCouncil) {
      dropped.push({ id, reason: "manual-only seat, never in a default council" });
      continue;
    }
    if (sensitivity === "private" && seat.locality === "cloud") {
      dropped.push({ id, reason: "cloud seat excluded for a private task" });
      continue;
    }
    if (!seatConfigured(id)) {
      dropped.push({ id, reason: "not configured (no key/endpoint)" });
      continue;
    }
    if (seats.length >= maxSeats) {
      dropped.push({ id, reason: "over seat budget" });
      continue;
    }
    seats.push(id);
  }
  return { seats, dropped };
}
