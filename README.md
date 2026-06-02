# ThumbRip — YouTube Thumbnail Downloader
**thumbrip.com**

A fast, free YouTube thumbnail downloader. Paste any YouTube URL and instantly download thumbnails in all 5 sizes (up to HD 1280×720).

## Files
- `index.html` — the complete website (single file, no framework needed)
- `robots.txt` — tells Google to index the site
- `sitemap.xml` — helps Google find your pages

## How to deploy on Vercel (no coding needed)

1. Go to github.com → create a new repository called `thumbrip`
2. Upload all 3 files (index.html, robots.txt, sitemap.xml)
3. Go to vercel.com → Add New Project → Import from GitHub
4. Select the `thumbrip` repo → click Deploy
5. Go to Settings → Domains → add `thumbrip.com`
6. Copy the 2 DNS records Vercel gives you → paste in your domain registrar

## Features
- Works with youtube.com, youtu.be, and Shorts URLs
- All 5 thumbnail sizes: Max Res, SD, HQ, MQ, Small
- No backend, no API key, no server needed
- Mobile friendly
- SEO optimized (meta tags, sitemap, robots.txt)
- Google AdSense ready (add your ad code in index.html)

## Adding Google AdSense
After AdSense approves your site, paste your ad code inside index.html
between the `<head>` tags and wherever you want ads to appear.
