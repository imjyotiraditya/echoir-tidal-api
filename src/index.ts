import { Hono } from "hono";
import { setupRoutes } from "./routes";
import { Env } from "./types";

// Create a new Hono app with typed bindings
const app = new Hono<{ Bindings: Env }>();

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
