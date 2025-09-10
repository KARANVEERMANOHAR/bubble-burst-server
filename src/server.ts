// src/server.ts
import express from "express";
import http from "http";
import { Server as SocketIOServer } from "socket.io";
import { MongoClient, ObjectId } from "mongodb";
import cors from "cors";

const MONGO_URI = "mongodb://localhost:27017";
const DB_NAME = "bubbleBurst";
const COLLECTION_NAME = "users";

let isScreen1Busy = false;
let isScreen2Busy = false;

const app = express();
app.use(express.json());

app.use(
  cors({ origin: "*", methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"] })
);

const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: "*" },
});

// MongoDB connection
let db: import("mongodb").Db | undefined;
// MongoDB collection for user scores
const USER_SCORES_COLLECTION = "userScores";

// Helper to upsert user score for a screen
async function upsertUserScore(
  userID: string,
  screen: "screen1" | "screen2",
  score: number
) {
  if (!db) throw new Error("DB not initialized");
  await db
    .collection(USER_SCORES_COLLECTION)
    .updateOne({ userID }, { $set: { [screen]: score } }, { upsert: true });
}

// Helper to get all user scores
async function getAllUserScores() {
  if (!db) throw new Error("DB not initialized");
  return db.collection(USER_SCORES_COLLECTION).find({}).toArray();
}

MongoClient.connect(MONGO_URI)
  .then((client: import("mongodb").MongoClient) => {
    db = client.db(DB_NAME);
    console.log("Connected to MongoDB");
  })
  .catch((err: unknown) => console.error("MongoDB connection error:", err));

io.on("connection", (socket: import("socket.io").Socket) => {
  console.log("Client connected:", socket.id);

  socket.on("screen1", (data: any) => {
    console.log("Received from screen1:", data);
  });

  socket.on("screen2", (data: any) => {
    console.log("Received from screen2:", data);
  });

  socket.on("controller1", () => {
    console.log("Controller1 connected:", socket.id);
    socket.emit("controller1", { isScreen1Busy, isScreen2Busy });
  });

  socket.on("controller2", () => {
    console.log("Controller2 connected:", socket.id);
    socket.emit("controller2", { isScreen1Busy, isScreen2Busy });
  });

  socket.on("statusUpdate", (data: { screen: number; isBusy: boolean }) => {
    socket.emit(`statusUpdate`, { isScreen1Busy, isScreen2Busy });
  });
});

// Helper to log API name to MongoDB
async function insertOne({ name }: { name: string }): Promise<any> {
  if (!db) return;
  return await db
    .collection(COLLECTION_NAME)
    .insertOne({ name, timestamp: new Date() });
}

// Helper to update user score
async function updateOne(
  id: string,
  score: number
): Promise<import("mongodb").UpdateResult | void> {
  if (!db) return;
  const { ObjectId } = require("mongodb");
  return await db
    .collection(COLLECTION_NAME)
    .updateOne({ _id: new ObjectId(id) }, { $set: { score } });
}

// API for screen 1
app.post(
  "/api/screen1",
  async (req: express.Request, res: express.Response) => {
    const data = req.body;
    isScreen1Busy = true;
    io.emit("controller1", { isScreen1Busy });
    io.emit("statusUpdate", { isScreen1Busy, isScreen2Busy });
    const player = await insertOne(data);
    const sendPlayer = player?.insertedId?.toString();
    io.emit("screen1", { ...data, sendPlayer });
    res.json({ status: "sent to screen1", data, isScreen1Busy, sendPlayer });
  }
);

// API for screen 2
app.post(
  "/api/screen2",
  async (req: express.Request, res: express.Response) => {
    const data = req.body;
    isScreen2Busy = true;
    io.emit("controller2", { isScreen2Busy });
    io.emit("statusUpdate", { isScreen1Busy, isScreen2Busy });
    const player = await insertOne(data);
    const sendPlayer = player?.insertedId?.toString();
    io.emit("screen2", { ...data, sendPlayer });
    res.json({ status: "sent to screen2", data, isScreen2Busy, sendPlayer });
  }
);

app.post(
  "/api/screen1/score",
  async (req: express.Request, res: express.Response) => {
    const { userID, score } = req.body;
    if (typeof userID !== "string" || typeof score !== "number") {
      return res
        .status(400)
        .json({ error: "userID (string) and score (number) required" });
    }
    try {
      await upsertUserScore(userID, "screen1", score);
      res.json({ status: "score recorded", userID, screen: "screen1", score });
    } catch (err) {
      res.status(500).json({ error: "Database error", details: err });
    }
  }
);

// Submit score for screen2
app.post(
  "/api/screen2/score",
  async (req: express.Request, res: express.Response) => {
    const { userID, score } = req.body;
    if (typeof userID !== "string" || typeof score !== "number") {
      return res
        .status(400)
        .json({ error: "userID (string) and score (number) required" });
    }
    try {
      await upsertUserScore(userID, "screen2", score);
      res.json({ status: "score recorded", userID, screen: "screen2", score });
    } catch (err) {
      res.status(500).json({ error: "Database error", details: err });
    }
  }
);

// Get winner by combined score
interface Player {
  _id: ObjectId;
  name: string;
  score: number;
  timestamp: Date;
}

app.get("/api/winner", async (req: express.Request, res: express.Response) => {
  try {
    const players = await db
      ?.collection<Player>(COLLECTION_NAME)
      .find({ score: { $exists: true } })
      .sort({ score: -1 })
      .sort({ timestamp: -1 })
      .limit(2)
      .toArray();

    let result: Player[] = [];

    if (players && players.length > 0) {
      if (players.length === 2) {
        const ts1 = new Date(players[0].timestamp).getTime();
        const ts2 = new Date(players[1].timestamp).getTime();

        if (Math.abs(ts1 - ts2) <= 20000) {
          result = [...players].sort(
            (a, b) =>
              b.score - a.score ||
              new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
          );
        } else {
          result = [players[0]];
        }
      } else {
        result = [players[0]];
      }
    }

    res.json({
      players: result.map((player) => ({
        _id: player._id,
        name: player.name,
        score: player.score,
        timestamp: player.timestamp,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: "Database error", details: err });
  }
});

app.post(
  "/api/resetScreens",
  async (req: express.Request, res: express.Response) => {
    const { screen1, screen2, userID, score } = req.body;
    if (screen1 === true) {
      isScreen1Busy = false;
      io.emit("controller1", { isScreen1Busy });
      io.emit("statusUpdate", { isScreen1Busy, isScreen2Busy });
      await updateOne(userID, score);
      res.json({ status: "reset", isScreen1Busy, isScreen2Busy });
    }
    if (screen2 === true) {
      isScreen2Busy = false;
      io.emit("controller2", { isScreen2Busy });
      io.emit("statusUpdate", { isScreen1Busy, isScreen2Busy });
      await updateOne(userID, score);
      res.json({ status: "reset", isScreen1Busy, isScreen2Busy });
    }

    if (screen1 !== true && screen2 !== true) {
      res.json({ status: "no screens reset", isScreen1Busy, isScreen2Busy });
    }
  }
);

const PORT: number = Number(process.env.PORT) || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
