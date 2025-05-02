/**
 * @file compatibility.ts
 * @description Utilities for checking system compatibility with LLM models
 */
import { exec } from "child_process";
import os from "os";
import { promisify } from "util";
import type { RecommendedModel } from "./recommended";

const execPromise = promisify(exec);

/**
 * System compatibility check result
 */
export type CompatibilityResult = {
  compatible: boolean;
  issues: string[];
  recommendations: string[];
  details: {
    availableRam: number;
    availableDisk: number;
    cpuCores: number;
    hasGpu: boolean;
    gpuInfo?: string;
  };
};

/**
 * Check if a specific model is compatible with the current system
 * @param model The model to check compatibility for
 * @returns Promise with compatibility result
 */
export async function checkModelCompatibility(
  model: RecommendedModel
): Promise<CompatibilityResult> {
  const issues: string[] = [];
  const recommendations: string[] = [];

  // Get system information
  const availableRam = os.totalmem();
  const freeMem = os.freemem();
  const cpuCores = os.cpus().length;

  // Check disk space - we'll check the home directory by default
  let availableDisk = 0;
  try {
    const diskInfo = await checkDiskSpace();
    availableDisk = diskInfo.available;
  } catch (err) {
    console.error("Error checking disk space:", err);
    issues.push("Could not determine available disk space");
  }

  // Check GPU - this is a basic check and might need improvement for different platforms
  let hasGpu = false;
  let gpuInfo = undefined;
  try {
    const gpuData = await checkGpu();
    hasGpu = gpuData.hasGpu;
    gpuInfo = gpuData.info;
  } catch (err) {
    console.error("Error checking GPU:", err);
    // Not adding to issues as GPU is optional
  }

  // Check compatibility with requirements
  if (model.requirements?.minRam && availableRam < model.requirements.minRam) {
    issues.push(
      `Insufficient RAM: System has ${formatBytes(availableRam)}, but model requires ${formatBytes(
        model.requirements.minRam
      )}`
    );
    recommendations.push(
      "Consider using a smaller model with lower memory requirements"
    );
  }

  if (
    model.requirements?.minDisk &&
    availableDisk < model.requirements.minDisk
  ) {
    issues.push(
      `Insufficient disk space: System has ${formatBytes(
        availableDisk
      )} available, but model requires ${formatBytes(
        model.requirements.minDisk
      )}`
    );
    recommendations.push("Free up disk space before installing this model");
  }

  if (model.requirements?.gpu && !hasGpu) {
    issues.push(
      "GPU recommended: This model works best with a GPU, but none was detected"
    );
    recommendations.push(
      "The model will run on CPU but may be slow. Consider using a smaller model for better performance."
    );
  }

  // Free memory check (not a hard requirement but useful to warn)
  if (freeMem < model.size * 1.5) {
    recommendations.push(
      `Low available memory: Only ${formatBytes(
        freeMem
      )} free. Consider closing other applications before using this model.`
    );
  }

  return {
    compatible: issues.length === 0,
    issues,
    recommendations,
    details: {
      availableRam,
      availableDisk,
      cpuCores,
      hasGpu,
      gpuInfo,
    },
  };
}

/**
 * Format bytes to a human-readable string
 * @param bytes Number of bytes
 * @returns Formatted string (e.g., "1.5 GB")
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes";

  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

/**
 * Check available disk space in the home directory
 * @returns Promise with available bytes
 */
async function checkDiskSpace(): Promise<{ available: number }> {
  const homedir = os.homedir();

  try {
    // For macOS and Linux
    if (process.platform === "darwin" || process.platform === "linux") {
      const { stdout } = await execPromise(`df -k "${homedir}"`);
      const lines = stdout.trim().split("\n");
      const parts = lines[lines.length - 1].split(/\s+/);
      // df output format varies, typically available space is at index 3
      const availableKB = parseInt(parts[3], 10);
      return { available: availableKB * 1024 };
    }
    // For Windows
    else if (process.platform === "win32") {
      // Get drive letter from homedir
      const driveLetter = homedir.split(":")[0] + ":";
      const { stdout } = await execPromise(
        `wmic logicaldisk where "DeviceID='${driveLetter}'" get FreeSpace`
      );
      const lines = stdout.trim().split("\n");
      const freeBytes = parseInt(lines[1], 10);
      return { available: freeBytes };
    }

    throw new Error(`Unsupported platform: ${process.platform}`);
  } catch (err) {
    console.error("Error checking disk space:", err);
    throw err;
  }
}

/**
 * Check if a GPU is available
 * @returns Promise with GPU info
 */
async function checkGpu(): Promise<{ hasGpu: boolean; info?: string }> {
  try {
    // For macOS
    if (process.platform === "darwin") {
      const { stdout } = await execPromise(
        "system_profiler SPDisplaysDataType"
      );
      // Check if there's a dedicated GPU
      const hasGpu = /Chipset Model:.*Radeon|GeForce|Intel Iris|AMD/i.test(
        stdout
      );
      return {
        hasGpu,
        info: hasGpu ? stdout.match(/Chipset Model:.*$/m)?.[0] : undefined,
      };
    }
    // For Linux
    else if (process.platform === "linux") {
      try {
        const { stdout } = await execPromise("lspci | grep -i 'vga\\|3d\\|2d'");
        const hasGpu = /nvidia|amd|radeon|intel/i.test(stdout);
        return { hasGpu, info: hasGpu ? stdout.trim() : undefined };
      } catch (_) {
        // lspci might not be available, try alternative
        const { stdout } = await execPromise(
          "glxinfo | grep 'OpenGL renderer'"
        );
        const hasGpu = !/llvmpipe|swrast/i.test(stdout); // Software renderers
        return { hasGpu, info: stdout.trim() };
      }
    }
    // For Windows
    else if (process.platform === "win32") {
      const { stdout } = await execPromise(
        "wmic path win32_VideoController get name"
      );
      const lines = stdout.trim().split("\n").slice(1); // Skip the header
      const gpuInfo = lines.join(", ").trim();
      const hasGpu =
        !/Microsoft Basic Display Adapter/i.test(gpuInfo) && gpuInfo !== "";
      return { hasGpu, info: gpuInfo };
    }

    // Default if platform check fails
    return { hasGpu: false };
  } catch (err) {
    console.error("Error checking GPU:", err);
    return { hasGpu: false };
  }
}
