/**
 * GET /api/api-docs
 *
 * Serves an interactive Swagger UI for the GhostLayer DLP OpenAPI 3.1 spec.
 *
 * Two sub-routes are handled by this single file:
 *
 *   GET /api/api-docs          – Full Swagger UI (HTML)
 *   GET /api/api-docs?yaml=1   – Raw OpenAPI YAML (for machine consumption)
 *
 * The Swagger UI is served via CDN links (swagger-ui-dist) so no additional
 * npm packages are required.
 *
 * Authentication note:
 *   The Swagger UI is intentionally unauthenticated so that CISOs and
 *   integration engineers can explore the API surface.  All underlying API
 *   endpoints still require valid credentials.
 */

import { NextResponse } from "next/server";
import { readFile }     from "fs/promises";
import path             from "path";

export const dynamic = "force-dynamic";

// Resolve the openapi.yaml located at the Next.js project root.
const OPENAPI_YAML_PATH = path.join(process.cwd(), "openapi.yaml");

const SWAGGER_UI_VERSION = "5.17.14";

const SWAGGER_HTML = (yamlUrl) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>GhostLayer DLP – API Reference</title>
  <link rel="icon" type="image/svg+xml"
        href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>👻</text></svg>" />
  <link rel="stylesheet"
        href="https://unpkg.com/swagger-ui-dist@${SWAGGER_UI_VERSION}/swagger-ui.css" />
  <style>
    body { margin: 0; background: #0f172a; }
    #swagger-ui .topbar { background: #0f172a; padding: 8px 0; }
    #swagger-ui .topbar a { display: none; }
    #swagger-ui .topbar::before {
      content: '👻 GhostLayer DLP – API Reference';
      color: #e2e8f0;
      font-size: 1.1rem;
      font-weight: 700;
      padding-left: 1.5rem;
      font-family: system-ui, sans-serif;
    }
    .swagger-ui .info .title { color: #0f172a; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>

  <script src="https://unpkg.com/swagger-ui-dist@${SWAGGER_UI_VERSION}/swagger-ui-bundle.js"></script>
  <script src="https://unpkg.com/swagger-ui-dist@${SWAGGER_UI_VERSION}/swagger-ui-standalone-preset.js"></script>
  <script>
    SwaggerUIBundle({
      url:            "${yamlUrl}",
      dom_id:         "#swagger-ui",
      presets:        [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
      layout:         "StandaloneLayout",
      deepLinking:    true,
      tryItOutEnabled: true,
      persistAuthorization: true,
      displayRequestDuration: true,
      filter:         true,
      syntaxHighlight: { activate: true, theme: "agate" },
    });
  </script>
</body>
</html>`;

export async function GET(request) {
  const { searchParams } = new URL(request.url);

  // ── Serve raw YAML ────────────────────────────────────────────────────────
  if (searchParams.has("yaml")) {
    try {
      const yaml = await readFile(OPENAPI_YAML_PATH, "utf8");
      return new NextResponse(yaml, {
        headers: {
          "Content-Type":  "application/yaml; charset=utf-8",
          "Cache-Control": "public, max-age=60",
        },
      });
    } catch (err) {
      return NextResponse.json(
        { error: `Could not read openapi.yaml: ${err.message}` },
        { status: 500 },
      );
    }
  }

  // ── Serve Swagger UI HTML ─────────────────────────────────────────────────
  // Build the YAML URL so Swagger UI can fetch the spec.
  const origin = request.headers.get("x-forwarded-proto")
    ? `${request.headers.get("x-forwarded-proto")}://${request.headers.get("host")}`
    : new URL(request.url).origin;

  const yamlUrl = `${origin}/api/api-docs?yaml=1`;
  const html    = SWAGGER_HTML(yamlUrl);

  return new NextResponse(html, {
    headers: {
      "Content-Type":  "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=60",
      // Allow framing from the same origin (for embedded dashboards)
      "X-Frame-Options": "SAMEORIGIN",
    },
  });
}
