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

const MACOS_EXECUTABLE_MARKER = `.app${path.sep}Contents${path.sep}MacOS${path.sep}`;

/**
 * The `.app` root of the running process, e.g.
 * `/Applications/FixLang.app/Contents/MacOS/FixLang` → `/Applications/FixLang.app`.
 *
 * Identity by path, not by bundle id: several copies of FixLang can carry the
 * same id (a stray `pack:mac` build in a checkout is the usual one), and
 * `open -b` is then free to launch the wrong one after an upgrade. Homebrew
 * replaces this exact path, so it is what the helper must reopen and what
 * reconcile compares against.
 */
export const appBundlePath = (executablePath: string): string | null => {
  const markerIndex = executablePath.indexOf(MACOS_EXECUTABLE_MARKER);
  if (markerIndex < 0) return null;

  const bundlePath = executablePath.slice(0, markerIndex + ".app".length);
  return path.isAbsolute(bundlePath) ? bundlePath : null;
};
