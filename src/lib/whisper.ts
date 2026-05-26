import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

function resolveFfmpegPath(): string | null {
  const override = process.env.FFMPEG_PATH;
  if (override?.trim()) return override.trim();

  if (!ffmpegPath) return null;
  // In ESM builds, some packages end up as { default: "..." }
  if (typeof ffmpegPath === "string") return ffmpegPath;
  const maybeDefault = (ffmpegPath as unknown as { default?: unknown }).default;
  return typeof maybeDefault === "string" ? maybeDefault : null;
}

export async function transcribeWithWhisper(
  audioBuffer: Buffer,
  fileExt = "webm",
): Promise<string> {
  const whisperBin = process.env.WHISPER_CPP_BIN;
  const modelPath = process.env.WHISPER_MODEL_PATH;
  if (!whisperBin || !modelPath) {
    throw new Error("Missing WHISPER_CPP_BIN or WHISPER_MODEL_PATH.");
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "echo-whisper-"));
  const inputPath = path.join(tmpDir, `meeting.${fileExt}`);
  const wavPath = path.join(tmpDir, "meeting.wav");
  const outBase = path.join(tmpDir, "transcript");

  await fs.writeFile(inputPath, audioBuffer);

  // whisper.cpp works most reliably with WAV input; convert webm/mp3/etc using ffmpeg.
  const whisperInputPath =
    fileExt.toLowerCase() === "wav"
      ? inputPath
      : await new Promise<string>((resolve, reject) => {
          const ffmpeg = resolveFfmpegPath();
          if (!ffmpeg) {
            reject(
              new Error(
                "ffmpeg not available. Install ffmpeg or set FFMPEG_PATH to ffmpeg.exe to enable webm->wav conversion.",
              ),
            );
            return;
          }
          const proc = spawn(ffmpeg, [
            "-y",
            "-i",
            inputPath,
            "-ac",
            "1",
            "-ar",
            "16000",
            wavPath,
          ]);
          let stderr = "";
          proc.stderr.on("data", (chunk) => {
            stderr += chunk.toString();
          });
          proc.on("error", (err) => {
            reject(new Error(`Failed to run ffmpeg at '${ffmpeg}': ${String(err)}`));
          });
          proc.on("close", (code) => {
            if (code === 0) resolve(wavPath);
            else reject(new Error(stderr || `ffmpeg failed with code ${code}`));
          });
        });

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(whisperBin, ["-m", modelPath, "-f", whisperInputPath, "-of", outBase, "-otxt"]);
    let stderr = "";
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", (err) => {
      reject(new Error(`Failed to run whisper binary at '${whisperBin}': ${String(err)}`));
    });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `whisper failed with code ${code}`));
    });
  });

  const transcriptPath = `${outBase}.txt`;
  let transcript: string;
  try {
    transcript = await fs.readFile(transcriptPath, "utf-8");
  } catch {
    const listing = await fs.readdir(tmpDir).catch(() => []);
    throw new Error(
      `Whisper completed but transcript not found at ${transcriptPath}. Files in temp: ${listing.join(", ") || "(none)"}`,
    );
  }
  return transcript.trim();
}
