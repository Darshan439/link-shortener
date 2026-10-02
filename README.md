# Link Shortener (Cloudflare Workers)

A small URL shortener I built to learn Cloudflare. It was my first time using Workers, D1 and KV, so I kept it simple but made sure it actually works end to end.

Live: https://api.darshangowda.workers.dev

## What it does
- Takes a long URL and gives back a short one
- Opening the short link redirects to the original URL
- Counts every click (time, country, browser)
- Shows stats for a link: total clicks, clicks per country, clicks per day
- Links can expire after some minutes

## Tech used
- TypeScript
- Hono (for routes)
- Cloudflare Workers (backend)
- D1 (database)
- KV (cache)
- Wrangler (to run locally and deploy)

## How it works
When someone opens a short link, the Worker first checks KV. If it's there, it redirects straight away. If not, it reads the link from D1, saves it in KV for next time, and then redirects. This is the same cache idea I used with Redis in my Tafuta project.

Clicks are saved after the redirect is sent, so the user doesn't wait for the database write.

## Endpoints
- `POST /shorten` creates a short link. Needs an `x-api-key` header. Body has `url` and optional `expiresInMinutes`
- `GET /:slug` redirects to the original URL (gives 410 if the link expired)
- `GET /stats/:slug` shows click stats
- `GET /health` just returns ok

Example:

curl -X POST https://api.darshangowda.workers.dev/shorten \
  -H "x-api-key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com","expiresInMinutes":60}'


## Run it locally

npm install
npx wrangler d1 migrations apply DB --local
npx wrangler dev

You also need a `.dev.vars` file in the project folder with `API_KEY=anything-you-like`.

## Things I learned
- A Worker is just a function that runs per request, so there is no server to manage
- KV can be a bit slow to update across locations, so I only keep link data there and D1 is the real source
- I used a 302 redirect because a 301 gets cached by the browser and then clicks wouldn't be counted
- Secrets go in `.dev.vars` locally and `wrangler secret put` when deployed, never in the code

## What I want to add next
- A small frontend on Cloudflare Pages