# Search and sharing metadata

## Why

voielibre.app serves a page whose body is an empty `<vl-root>` and whose head holds only a title. `robots.txt` and `sitemap.xml` answer with the home page (the server sends `index.html` for any path that is not a file). A search engine, or a messenger drawing a preview of a shared link, finds nothing to say about the app.

## What done looks like

1. **Head tags** in `index.html`: a title that says what the app does, a description, the canonical URL, `lang`, the Open Graph and Twitter card tags with the social preview image (`public/social-preview.png`, from `docs/social-preview.png`).
2. **`robots.txt` and `sitemap.xml`** as real files in `public/`, served as plain text and XML: everything may be crawled except `/api/`, `/tiles/` and the shared routes (`/p/`); the sitemap lists the home page.
3. **Visible content in the app root**: a short text in English and in French (what the app is, what it does, free and without account) inside `<vl-root>`, replaced by the app when it starts, so that a crawler or a reader without JavaScript finds the page described; and a `<noscript>` line saying that the app needs JavaScript and WebGL.
4. **JSON-LD** (`WebApplication`): name, address, description, free, sports category, languages, screenshot, licence and code.

The app itself does not change. No server-side rendering.

## How we check

- The build keeps all of it (the files in `dist`), the JSON-LD parses, the image has the size of an Open Graph image, and the head of the page served by the production build shows the tags.
- After the deployment: `https://voielibre.app/robots.txt` and `/sitemap.xml` answer with their own content type; a link preview tool and the browser's Lighthouse (SEO) read the tags.

## Out of scope

- A French version with its own address and `hreflang` (`/fr`).
- Pages written for searches ("gravel route planner", "GPX trail"), and the Search Console registration (the author's call).
