import { Hono } from "hono";
import { setupRoutes } from "./routes";
import { Redis } from "@upstash/redis/cloudflare";
import { Env } from "./types";

// Create a new Hono app with typed bindings
const app = new Hono<{ Bindings: Env }>();

// Initialize storage providers
app.use("*", async (c, next) => {
  // Set default storage preference if not set
  if (!c.env.STORAGE_PREFERENCE) {
    c.env.STORAGE_PREFERENCE = "auto";
  }

  // Set default flags based on storage preference
  if (
    c.env.D1_DB &&
    (c.env.STORAGE_PREFERENCE === "d1" || c.env.STORAGE_PREFERENCE === "auto")
  ) {
    c.env.USE_D1 = true;
  } else {
    c.env.USE_D1 = false;
  }

  // Initialize Redis if configured
  if (c.env.UPSTASH_REDIS_URL && c.env.UPSTASH_REDIS_TOKEN) {
    // Initialize Redis client
    c.env.REDIS = new Redis({
      url: c.env.UPSTASH_REDIS_URL,
      token: c.env.UPSTASH_REDIS_TOKEN,
    });

    // Set USE_REDIS flag if D1 is not being used and Redis is preferred
    if (
      !c.env.USE_D1 &&
      (c.env.STORAGE_PREFERENCE === "redis" ||
        c.env.STORAGE_PREFERENCE === "auto")
    ) {
      c.env.USE_REDIS = true;
    } else {
      c.env.USE_REDIS = false;
    }
  }

  await next();
});

// Log the initial storage configuration
app.use("*", async (c, next) => {
  // Only log once per instance (on first request)
  if (!c.env.STORAGE_LOGGED) {
    c.env.STORAGE_LOGGED = true;

    console.log("======= TIDAL API STORAGE CONFIGURATION =======");
    console.log(`Storage Preference: ${c.env.STORAGE_PREFERENCE || "auto"}`);
    console.log(
      `Primary Storage: ${c.env.USE_D1 ? "D1" : c.env.USE_REDIS ? "Redis" : "KV"}`,
    );

    if (c.env.D1_DB) {
      console.log(`D1 Database: Available${c.env.USE_D1 ? " (ACTIVE)" : ""}`);
    } else {
      console.log("D1 Database: Not Configured");
    }

    console.log(
      `KV Namespace: Available${!c.env.USE_D1 && !c.env.USE_REDIS ? " (ACTIVE)" : ""}`,
    );

    if (c.env.REDIS) {
      console.log(`Redis: Available${c.env.USE_REDIS ? " (ACTIVE)" : ""}`);
    } else {
      console.log("Redis: Not Configured");
    }

    console.log("===============================================");
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
