import { docs } from "../lib/docs";
export function GET() {
  const paths = ["/", ...docs.map((doc) => `/docs/${doc.slug}/`)];
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map((path) => `<url><loc>https://voiceinput.dev${path}</loc></url>`).join("")}</urlset>`,
    { headers: { "Content-Type": "application/xml" } },
  );
}
