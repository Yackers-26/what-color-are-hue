// Connects to MongoDB Atlas once and shares the connection with every route.
import { MongoClient } from "mongodb";

let db = null;

export async function connectToDatabase() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error("MONGODB_URI is missing. Copy .env.example to .env and paste your Atlas connection string.");
  }

  const client = new MongoClient(uri);
  await client.connect();

  db = client.db(process.env.MONGODB_DB || "huememory");

  // Indexes keep lookups fast and stop duplicate shades per session.
  await db.collection("colors").createIndex({ sessionId: 1, shade: 1 }, { unique: true });
  await db.collection("tasks").createIndex({ sessionId: 1, createdAt: -1 });

  console.log(`Connected to MongoDB database "${db.databaseName}"`);
  return db;
}

export function getDb() {
  if (!db) throw new Error("Database not connected yet");
  return db;
}
