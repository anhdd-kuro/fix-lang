import path from "node:path";

const isInside = (candidatePath: string, rootPath: string): boolean => {
  const relativePath = path.relative(
    path.resolve(rootPath),
    path.resolve(candidatePath),
  );

  return (
    relativePath.length > 0 &&
    relativePath !== ".." &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath)
  );
};

/**
 * Automatic checks are useful only for installed macOS applications. A
 * packaged directory build can still be checked manually from Settings, but
 * should not contact the release feed merely because it was launched.
 */
export const shouldCheckForUpdatesOnLaunch = (
  executablePath: string,
  homePath: string,
): boolean =>
  isInside(executablePath, "/Applications") ||
  isInside(executablePath, path.join(homePath, "Applications"));
