import type { VercelRequest, VercelResponse } from "@vercel/node";

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.status(200).json({
    name: "Lightpanda Serverless",
    description: "Headless browser as a Vercel function",
    endpoints: {
      fetch: {
        path: "/api/fetch",
        params: {
          url: "URL to fetch (default: https://example.com)",
          format: "Output format: html | markdown | semantic_tree | semantic_tree_text (default: markdown)",
        },
        example: "/api/fetch?url=https://example.com&format=markdown",
      },
    },
  });
}
