import { AppError } from "../cli/foundation/error-map.js";

/**
 * The published spec is not served as a file. `docs.spaceship.dev` renders
 * Redoc with the whole OpenAPI document embedded in a `__redoc_state` literal,
 * so the extractor slices that object out of the page.
 *
 * There is no ETag and `info.version` never moves, so a change can only be
 * detected by comparing content. `last-modified` covers the HTML page, not the
 * spec inside it, which makes it a hint rather than proof.
 */

export const DOCS_URL = "https://docs.spaceship.dev/";

const MARKER = "__redoc_state = ";

export type FetchedSpec = {
  spec: Record<string, unknown>;
  /** From the page's Last-Modified header, when present. */
  lastModified: string | null;
  fetchedAt: string;
};

/**
 * Pulls the first complete JSON object starting at `from`, by tracking brace
 * depth outside of strings. A regex cannot do this: the document contains
 * braces inside descriptions and code samples.
 */
export function sliceJsonObject(source: string, from: number): string {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = from; i < source.length; i++) {
    const char = source[i] as string;

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0) return source.slice(from, i + 1);
    }
  }

  throw new AppError("spec.unparsable", {
    name: "UnterminatedObject",
    human: "The embedded spec object never closed.",
    hint: "The documentation page layout may have changed.",
  });
}

export function extractSpecFromHtml(html: string): Record<string, unknown> {
  const marker = html.indexOf(MARKER);
  if (marker === -1) {
    throw new AppError("spec.unparsable", {
      name: "MarkerMissing",
      human: "Could not find the embedded spec in the documentation page.",
      hint: "Spaceship may have changed how the docs are rendered. The snapshot on disk is unchanged.",
    });
  }

  const start = html.indexOf("{", marker);
  const raw = sliceJsonObject(html, start);

  let state: { spec?: { data?: unknown } };
  try {
    state = JSON.parse(raw) as typeof state;
  } catch (cause) {
    throw new AppError(
      "spec.unparsable",
      {
        name: "InvalidJson",
        human: "The embedded spec is not valid JSON.",
        hint: "The documentation page layout may have changed.",
      },
      cause,
    );
  }

  const spec = state.spec?.data;
  if (!spec || typeof spec !== "object" || !("paths" in spec)) {
    throw new AppError("spec.unparsable", {
      name: "NotASpec",
      human: "The embedded object does not look like an OpenAPI document.",
      hint: "Expected `spec.data.paths` to be present.",
    });
  }

  return spec as Record<string, unknown>;
}

export async function fetchSpec(
  options: { url?: string; fetchImpl?: typeof globalThis.fetch } = {},
): Promise<FetchedSpec> {
  const url = options.url ?? DOCS_URL;
  const doFetch = options.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await doFetch(url);
  } catch (cause) {
    throw new AppError(
      "network",
      {
        name: "NetworkError",
        human: `Could not reach ${new URL(url).host}.`,
        hint: "The snapshot on disk is unchanged.",
      },
      cause,
    );
  }

  if (!response.ok) {
    throw new AppError("upstream", {
      name: "DocsUnavailable",
      human: `The documentation page answered ${response.status}.`,
      hint: "The snapshot on disk is unchanged.",
    });
  }

  const html = await response.text();
  return {
    spec: extractSpecFromHtml(html),
    lastModified: response.headers.get("last-modified"),
    fetchedAt: new Date().toISOString(),
  };
}
