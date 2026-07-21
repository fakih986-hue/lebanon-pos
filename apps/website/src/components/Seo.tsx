import { useEffect } from "react"
import { SITE_NAME, OG_IMAGE, canonicalFor } from "../lib/seo"

// Client-rendered SPA, so per-route <head> tags are set imperatively on mount /
// route change. This upgrades browser tab titles and gives JS-rendering crawlers
// (Googlebot) accurate per-page metadata. Non-rendering social scrapers (WhatsApp,
// LinkedIn) read the STATIC defaults baked into index.html — keep those sensible.

type SeoProps = {
  /** Full document title, e.g. "Titan POS — Offline-first POS for Lebanon". */
  title: string
  description: string
  /** Route path, e.g. "/pos". Drives canonical + og:url. */
  path: string
  /** Open Graph type. "website" for most pages, "article" for posts. */
  ogType?: string
  /** Absolute image URL for the social card. Defaults to the brand image. */
  image?: string
  /** Optional structured data (schema.org). One object or several. */
  jsonLd?: object | object[]
}

function upsertMeta(selector: string, attr: "name" | "property", key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(selector)
  if (!el) {
    el = document.createElement("meta")
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.setAttribute("content", content)
}

function upsertLink(rel: string, href: string) {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`)
  if (!el) {
    el = document.createElement("link")
    el.setAttribute("rel", rel)
    document.head.appendChild(el)
  }
  el.setAttribute("href", href)
}

const JSONLD_ID = "route-jsonld"

export function Seo({ title, description, path, ogType = "website", image, jsonLd }: SeoProps) {
  useEffect(() => {
    const url = canonicalFor(path)
    const img = image ?? OG_IMAGE

    document.title = title
    upsertMeta('meta[name="description"]', "name", "description", description)
    upsertLink("canonical", url)

    // Open Graph
    upsertMeta('meta[property="og:title"]', "property", "og:title", title)
    upsertMeta('meta[property="og:description"]', "property", "og:description", description)
    upsertMeta('meta[property="og:url"]', "property", "og:url", url)
    upsertMeta('meta[property="og:type"]', "property", "og:type", ogType)
    upsertMeta('meta[property="og:image"]', "property", "og:image", img)
    upsertMeta('meta[property="og:site_name"]', "property", "og:site_name", SITE_NAME)

    // Twitter / X
    upsertMeta('meta[name="twitter:card"]', "name", "twitter:card", "summary_large_image")
    upsertMeta('meta[name="twitter:title"]', "name", "twitter:title", title)
    upsertMeta('meta[name="twitter:description"]', "name", "twitter:description", description)
    upsertMeta('meta[name="twitter:image"]', "name", "twitter:image", img)

    // Structured data (replace the single route-scoped node each navigation)
    const existing = document.getElementById(JSONLD_ID)
    if (jsonLd) {
      const script = existing ?? document.createElement("script")
      script.id = JSONLD_ID
      script.setAttribute("type", "application/ld+json")
      script.textContent = JSON.stringify(jsonLd)
      if (!existing) document.head.appendChild(script)
    } else if (existing) {
      existing.remove()
    }
  }, [title, description, path, ogType, image, jsonLd])

  return null
}
