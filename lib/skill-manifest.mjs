/** The schema of `skill.json`, which is one half of the contract between the two repositories. */

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TEACHES = /^@theokit\/[a-z0-9-]+(?:\/[a-z0-9-]+)*$/;

export class ManifestError extends Error {
  constructor(message, { path, field }) {
    super(`${path}: ${field}: ${message}`);
    this.name = "ManifestError";
    this.path = path;
    this.field = field;
  }
}

function requireNonEmptyStrings(value, { path, field }) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ManifestError("must be a non-empty array", { path, field });
  }
  for (const entry of value) {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      throw new ManifestError("every entry must be a non-empty string", { path, field });
    }
  }
  return value;
}

export function parseManifest(raw, path) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ManifestError("must be a JSON object", { path, field: "<root>" });
  }

  const skill = raw.skill;
  if (typeof skill !== "string" || !skill.startsWith("theokit-") || !KEBAB.test(skill)) {
    throw new ManifestError('must be kebab-case and start with "theokit-"', { path, field: "skill" });
  }

  const concept = raw.concept;
  if (typeof concept !== "string" || concept.trim().length === 0) {
    throw new ManifestError("must be a non-empty string", { path, field: "concept" });
  }

  const teaches = requireNonEmptyStrings(raw.teaches, { path, field: "teaches" });
  for (const entry of teaches) {
    if (!TEACHES.test(entry)) {
      throw new ManifestError(`"${entry}" is not a @theokit export subpath`, { path, field: "teaches" });
    }
  }

  const triggers = requireNonEmptyStrings(raw.triggers, { path, field: "triggers" });
  const notCovered = requireNonEmptyStrings(raw.notCovered, { path, field: "notCovered" });

  if (!Array.isArray(raw.regions) || raw.regions.length === 0) {
    throw new ManifestError("must be a non-empty array", { path, field: "regions" });
  }
  const regions = raw.regions.map((region) => {
    if (region === null || typeof region !== "object") {
      throw new ManifestError("every entry must be an object", { path, field: "regions" });
    }
    if (typeof region.id !== "string" || !KEBAB.test(region.id)) {
      throw new ManifestError(`id "${region.id}" must be kebab-case`, { path, field: "regions" });
    }
    if (typeof region.explains !== "string" || region.explains.trim().length === 0) {
      throw new ManifestError(`region "${region.id}" needs a non-empty explains`, { path, field: "regions" });
    }
    return { id: region.id, explains: region.explains };
  });

  const credentials = raw.credentials ?? [];
  if (!Array.isArray(credentials) || credentials.some((entry) => typeof entry !== "string")) {
    throw new ManifestError("must be an array of strings", { path, field: "credentials" });
  }

  const evidence = raw.evidence ?? [];
  if (!Array.isArray(evidence)) {
    throw new ManifestError("must be an array", { path, field: "evidence" });
  }
  const parsedEvidence = evidence.map((entry) => {
    if (
      entry === null ||
      typeof entry !== "object" ||
      typeof entry.command !== "string" ||
      typeof entry.claims !== "string" ||
      entry.command.trim().length === 0 ||
      entry.claims.trim().length === 0
    ) {
      throw new ManifestError("every entry needs a command and a claims", { path, field: "evidence" });
    }
    return { command: entry.command, claims: entry.claims };
  });

  return { skill, teaches, concept, triggers, regions, notCovered, credentials, evidence: parsedEvidence };
}
