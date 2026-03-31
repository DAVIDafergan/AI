import mongoose from "mongoose";

// Global cache to prevent multiple connections in serverless / hot-reload environments
let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

/**
 * connectToDB – returns a cached Mongoose connection.
 * Reads MONGODB_URI from environment variables.
 */
export async function connectToDB() {
  if (cached.conn) {
    return cached.conn;
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI environment variable is not set.");
  }

  if (!cached.promise) {
    cached.promise = mongoose
      .connect(uri, {
        bufferCommands: false,
      })
      .then((m) => m);
  }

  cached.conn = await cached.promise;
  return cached.conn;
}
