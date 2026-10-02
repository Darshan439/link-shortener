import { Hono } from "hono";
import { customAlphabet } from "nanoid";

const makeSlug = customAlphabet(
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
  7
);

type Link = { url: string; expiresAt: number | null };

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => c.text("Link shortener API"));
app.get("/health", (c) => c.text("ok"));

// Create a short link

app.use("/shorten", async (c, next) => {
  const key = c.req.header("x-api-key");
  if (!key || key !== c.env.API_KEY) {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
});

app.post("/shorten", async (c) => {
  const body = await c.req
    .json<{ url?: string; expiresInMinutes?: number }>()
    .catch(() => null);
  if (!body?.url) return c.json({ error: "url is required" }, 400);

  try {
    const parsed = new URL(body.url);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
  } catch {
    return c.json({ error: "invalid url" }, 400);
  }

  if (
    body.expiresInMinutes !== undefined &&
    (typeof body.expiresInMinutes !== "number" || body.expiresInMinutes <= 0)
  ) {
    return c.json({ error: "expiresInMinutes must be a positive number" }, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  const expiresAt = body.expiresInMinutes
    ? now + Math.floor(body.expiresInMinutes * 60)
    : null;

  for (let attempt = 0; attempt < 3; attempt++) {
    const slug = makeSlug();
    try {
      await c.env.DB
        .prepare(
          "INSERT INTO links (slug, url, created_at, expires_at) VALUES (?, ?, ?, ?)"
        )
        .bind(slug, body.url, now, expiresAt)
        .run();
      const origin = new URL(c.req.url).origin;
      return c.json({ slug, shortUrl: `${origin}/${slug}`, expiresAt }, 201);
    } catch {
      // slug already exists (UNIQUE), loop and try a new one
    }
  }
  return c.json({ error: "could not create link" }, 500);
});

// Click analytics for a link
app.get("/stats/:slug", async (c) => {
  const slug = c.req.param("slug");

  const link = await c.env.DB
    .prepare("SELECT url FROM links WHERE slug = ?")
    .bind(slug)
    .first<{ url: string }>();
  if (!link) return c.json({ error: "not found" }, 404);

  const total = await c.env.DB
    .prepare("SELECT COUNT(*) AS total FROM clicks WHERE slug = ?")
    .bind(slug)
    .first<{ total: number }>();

  const byCountry = await c.env.DB
    .prepare(
      "SELECT country, COUNT(*) AS clicks FROM clicks WHERE slug = ? GROUP BY country ORDER BY clicks DESC"
    )
    .bind(slug)
    .all();

  const byDay = await c.env.DB
    .prepare(
      "SELECT date(clicked_at, 'unixepoch') AS day, COUNT(*) AS clicks FROM clicks WHERE slug = ? GROUP BY day ORDER BY day"
    )
    .bind(slug)
    .all();

  return c.json({
    slug,
    url: link.url,
    totalClicks: total?.total ?? 0,
    byCountry: byCountry.results,
    byDay: byDay.results,
  });
});

// Redirect: KV first, D1 fallback, log click, 302
app.get("/:slug", async (c) => {
  const slug = c.req.param("slug");

  let link = await c.env.LINKS.get<Link>(slug, "json");

  if (link) {
    console.log("cache hit:", slug);
  } else {
    console.log("cache miss:", slug);
    const row = await c.env.DB
      .prepare("SELECT url, expires_at FROM links WHERE slug = ?")
      .bind(slug)
      .first<{ url: string; expires_at: number | null }>();
    if (!row) return c.text("Not found", 404);
    link = { url: row.url, expiresAt: row.expires_at };
    await c.env.LINKS.put(slug, JSON.stringify(link));
  }

  const now = Math.floor(Date.now() / 1000);
  if (link.expiresAt && link.expiresAt <= now) {
    return c.text("This link has expired", 410);
  }

  const cf = (c.req.raw as Request & { cf?: { country?: string } }).cf;

  c.executionCtx.waitUntil(
    c.env.DB
      .prepare(
        "INSERT INTO clicks (slug, clicked_at, country, user_agent) VALUES (?, ?, ?, ?)"
      )
      .bind(
        slug,
        now,
        cf?.country ?? null,
        c.req.header("user-agent") ?? null
      )
      .run()
  );

  return c.redirect(link.url, 302);
});

export default app;