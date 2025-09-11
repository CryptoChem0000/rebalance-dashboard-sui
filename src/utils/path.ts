import { exec } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

/**
 * Get the git repository root path
 *
 * @returns Promise containing the path or undefined if not found
 */
export const getGitRepositoryRoot = async (): Promise<string | undefined> => {
  try {
    const result = await promisify(exec)("git rev-parse --show-toplevel");
    if (result.stderr) {
      return undefined;
    }

    return result.stdout.trim();
  } catch {
    return undefined;
  }
};

/**
 * Get the working directory path, which is the git repository root or otherwise the current directory
 *
 * @param workingDir - Optional - Manual override of the working directory
 * @returns Promise containing the working directory path
 */
export const getWorkingDirectory = async (
  workingDir?: string
): Promise<string> => {
  const repositoryRoot =
    (workingDir && resolve(workingDir)) || (await getGitRepositoryRoot());

  return repositoryRoot || process.cwd();
};
