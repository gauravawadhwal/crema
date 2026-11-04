import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ImageInput } from "./types.js";

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${cmd} timed out after ${opts.timeoutMs}ms`));
    }, opts.timeoutMs ?? 180_000);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

const EXT: Record<ImageInput["mediaType"], string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** Write images into a fresh scratch dir; returns the dir and file names. */
export async function stageImages(images: ImageInput[] = []) {
  const dir = await mkdtemp(path.join(tmpdir(), "crema-"));
  const files: string[] = [];
  for (const [i, img] of images.entries()) {
    const name = `bag-${i + 1}.${EXT[img.mediaType]}`;
    await writeFile(path.join(dir, name), img.data);
    files.push(name);
  }
  return { dir, files, cleanup: () => rm(dir, { recursive: true, force: true }) };
}
