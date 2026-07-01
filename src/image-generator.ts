import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";
import { config } from "./config.js";
import type { Artifact } from "./types.js";

export class ImageGenerator {
  private readonly client?: OpenAI;
  private readonly outputDir = path.join(config.projectRoot, "data/generated");

  constructor() {
    if (config.openai.apiKey) {
      this.client = new OpenAI({ apiKey: config.openai.apiKey, timeout: config.requestTimeoutMs, maxRetries: 0 });
    }
  }

  get available(): boolean {
    return Boolean(this.client);
  }

  async generate(prompt: string): Promise<Artifact> {
    if (!this.client) throw new Error("OPENAI_API_KEY is not configured");

    const response = await this.client.images.generate({
      model: config.openai.imageModel,
      prompt,
      size: "1024x1024",
      quality: "medium",
    });
    const first = response.data?.[0];
    const base64 = first?.b64_json;
    if (!base64) {
      throw new Error("The image API returned no base64 image data");
    }

    await mkdir(this.outputDir, { recursive: true });
    const filename = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}.png`;
    await writeFile(path.join(this.outputDir, filename), Buffer.from(base64, "base64"));
    return { type: "image", url: `/generated/${filename}`, prompt };
  }
}
