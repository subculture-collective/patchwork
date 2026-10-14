import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { render, publicPageMeta, publicOrigin } from '../dist-ssr/entry-prerender.js';
const template = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
const escape = value => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const body = render();
if (!body.includes('<h1') || !body.includes('<main')) throw new Error('Public introduction did not render');
for (const [path, meta] of Object.entries(publicPageMeta)) {
    const folder = new URL(`../dist${path === '/' ? '' : path}/`, import.meta.url);
    const url = publicOrigin + path;
    let html = template.replace('<title>Patchwork</title>', `<title>${escape(meta.title)}</title>`).replace('</head>', `<meta name="description" content="${escape(meta.description)}"><link rel="canonical" href="${url}"><meta property="og:type" content="website"><meta property="og:title" content="${escape(meta.title)}"><meta property="og:description" content="${escape(meta.description)}"><meta property="og:url" content="${url}"></head>`);
    if (path === '/') html = html.replace('<div id="root"></div>', `<div id="root">${body}</div>`);
    await mkdir(folder, { recursive: true });
    await writeFile(new URL('index.html', folder), html);
}
await writeFile(new URL('../dist/app.html', import.meta.url), template.replace('</head>', '<meta name="robots" content="noindex,nofollow"></head>'));
await writeFile(new URL('../dist/robots.txt', import.meta.url), `User-agent: *\nAllow: /\n\nSitemap: ${publicOrigin}/sitemap.xml\n`);
await writeFile(new URL('../dist/sitemap.xml', import.meta.url), `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${Object.keys(publicPageMeta).map(path => `<url><loc>${publicOrigin}${path}</loc></url>`).join('')}</urlset>`);
