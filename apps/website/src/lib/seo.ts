// ─────────────────────────────────────────────────────────────────────────────
// Central SEO config for the Titan marketing site.
//
// OWNER: if the production domain is ever anything other than the apex
// titan-suite.net (e.g. you serve from www.titan-suite.net), update SITE_URL
// here AND the two absolute URLs in public/robots.txt + public/sitemap.xml so
// canonical tags, Open Graph URLs, and the sitemap all agree.
// ─────────────────────────────────────────────────────────────────────────────

export const SITE_URL = "https://titan-suite.net"
export const SITE_NAME = "Titan"

// Social preview image (WhatsApp / LinkedIn / X / iMessage). Absolute URL.
// NOTE: this reuses the brand logo. A dedicated 1200×630 banner reads better as
// a social card — drop one at public/brand/og-cover.png and point OG_IMAGE here.
export const OG_IMAGE = `${SITE_URL}/brand/titan-logo-full.png`

/** Absolute canonical URL for a route path (e.g. "/pos" → ".../pos", "/" → ".../"). */
export function canonicalFor(path: string): string {
  return path === "/" ? `${SITE_URL}/` : `${SITE_URL}${path}`
}

/** Organization node — the publisher behind every page. Injected site-wide. */
export const ORGANIZATION_JSONLD = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: SITE_NAME,
  url: SITE_URL,
  logo: `${SITE_URL}/brand/titan-logo-full.png`,
  description:
    "Titan builds commercial-grade software for real businesses — point of sale, HR, and payroll, built Lebanon-first to run day-to-day operations.",
  email: "hello@titan-suite.net",
  foundingLocation: { "@type": "Place", name: "Lebanon" },
}

/** SoftwareApplication node for a Titan product page. */
export function softwareAppJsonLd(opts: {
  name: string
  path: string
  description: string
  category: string
}) {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: opts.name,
    url: canonicalFor(opts.path),
    applicationCategory: opts.category,
    operatingSystem: "Windows",
    description: opts.description,
    publisher: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
  }
}
