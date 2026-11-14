import { MongoClient } from "mongodb";

let db = null;
let client = null;

export async function connectToDatabase() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is missing.");

  client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 8000,
    connectTimeoutMS: 8000
  });
  await client.connect();

  db = client.db(process.env.MONGODB_DB || "huememory");
  await db.collection("colors").createIndex({ sessionId: 1, shade: 1 }, { unique: true });
  await db.collection("tasks").createIndex({ sessionId: 1, createdAt: -1 });

  console.log(`Connected to MongoDB database "${db.databaseName}"`);
  return db;
}

export function getDb() {
  if (!db) throw new Error("MongoDB is not connected. Check MONGODB_URI and Atlas network access.");
  return db;
}

export function isDatabaseConnected() {
  return Boolean(db);
}
