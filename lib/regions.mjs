/**
 * Region markers are the contract between an example that runs and a skill that ships. Everything
 * between the markers is copied verbatim into the skill, comments included: an example's doc
 * comments record what a signature cannot, and paraphrasing them would lose the only content here
 * that no model could reproduce.
 */

const OPEN = /^\s*\/\/\s*#region\s+skill:([a-z0-9]+(?:-[a-z0-9]+)*)\s*$/;
const CLOSE = /^\s*\/\/\s*#endregion\s*$/;

export class RegionError extends Error {
  constructor(message, { file, line }) {
    super(`${file}:${line}: ${message}`);
    this.name = "RegionError";
    this.file = file;
    this.line = line;
  }
}

/**
 * Parse the regions declared in one source file.
 *
 * An id that is not kebab-case does not match OPEN and is therefore not a region at all, rather
 * than a malformed one. The manifest cross-check in `example-contract.mjs` is what turns a typo
 * into a named error: the id it declares will have no match here.
 */
export function parseRegions(source, file) {
  const regions = [];
  let open = null;

  source.split("\n").forEach((text, index) => {
    const line = index + 1;

    const opened = OPEN.exec(text);
    if (opened !== null) {
      const id = opened[1];
      if (open !== null) {
        throw new RegionError(`region "${id}" opens inside region "${open.id}"`, { file, line });
      }
      open = { id, startLine: line, body: [] };
      return;
    }

    if (CLOSE.test(text)) {
      if (open === null) {
        throw new RegionError("#endregion with no open region", { file, line });
      }
      regions.push({
        id: open.id,
        file,
        startLine: open.startLine,
        endLine: line,
        code: open.body.join("\n"),
      });
      open = null;
      return;
    }

    if (open !== null) open.body.push(text);
  });

  if (open !== null) {
    throw new RegionError(`region "${open.id}" is never closed`, { file, line: open.startLine });
  }

  return regions;
}
