import { Hono } from "hono";
import { setupRoutes } from "./routes";
import { Redis } from "@upstash/redis/cloudflare";
import { Env } from "./types";

// Create a new Hono app with typed bindings
const app = new Hono<{ Bindings: Env }>();

// Initialize Redis instance
app.use("*", async (c, next) => {
  if (c.env.UPSTASH_REDIS_URL && c.env.UPSTASH_REDIS_TOKEN) {
    // Initialize Redis client
    c.env.REDIS = new Redis({
      url: c.env.UPSTASH_REDIS_URL,
      token: c.env.UPSTASH_REDIS_TOKEN,
    });

    // Set initial storage preference
    if (!c.env.STORAGE_PREFERENCE) {
      c.env.STORAGE_PREFERENCE = "auto";
    }

    // Set USE_REDIS flag based on storage preference
    c.env.USE_REDIS = c.env.STORAGE_PREFERENCE === "redis";
  }

  await next();
});

// Define a healthcheck route
app.get("/", (c) => {
  return c.text(`${c.env.APP_TITLE} ${c.env.APP_VERSION} is running!`);
});

// Configure all API routes
setupRoutes(app);

// 404 handler
app.notFound((c) => {
  return c.json({ error: "Not Found" }, 404);
});

// Error handler
app.onError((err, c) => {
  console.error(`Error: ${err.message}`);
  return c.json(
    {
      error: err.message || "Internal Server Error",
      status: err.status || 500,
    },
    err.status || 500,
  );
});

export default app;
