import mongoose from "mongoose";

// Global cache to prevent multiple connections in serverless / hot-reload environments
let cached = global.mongoose;
let warnedLocalMode = false;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

function getMongoUri() {
  const value = process.env.MONGODB_URI;
  if (!value || !value.trim()) return null;
  const trimmed = value.trim();
  if (trimmed.includes("<") || trimmed.includes("your-")) return null;
  return trimmed;
}

function warnLocalMode() {
  if (warnedLocalMode) return;
  warnedLocalMode = true;
  console.warn("[GhostLayer] Running without MongoDB – data will not persist");
}

/**
 * connectToDB – returns a cached Mongoose connection.
 * Reads MONGODB_URI from environment variables.
 */
export async function connectToDB() {
  const uri = getMongoUri();
  if (!uri) {
    warnLocalMode();
    return null;
  }

  if (cached.conn) {
    return cached.conn;
  }

  if (!cached.promise) {
    cached.promise = mongoose
      .connect(uri, {
        bufferCommands: false,
      })
      .then((m) => m)
      .catch((err) => {
        cached.promise = null;
        console.error("[connectToDB] Failed to connect:", err.message);
        throw err;
      });
  }

  cached.conn = await cached.promise;
  return cached.conn;
}
