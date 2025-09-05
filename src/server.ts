// src/server.ts
import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { MongoClient } from 'mongodb';

const MONGO_URI = 'mongodb://localhost:27017';
const DB_NAME = 'bubbleBurst';
const COLLECTION_NAME = 'apiLogs';

let isScreen1Busy = false;
let isScreen2Busy = false;

const app = express();
app.use(express.json());

const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: '*' }
});

// MongoDB connection
let db: import('mongodb').Db | undefined;
MongoClient.connect(MONGO_URI)
  .then((client: import('mongodb').MongoClient) => {
    db = client.db(DB_NAME);
    console.log('Connected to MongoDB');
  })
  .catch((err: unknown) => console.error('MongoDB connection error:', err));

// Socket.IO listeners
io.on('connection', (socket: import('socket.io').Socket) => {
  console.log('Client connected:', socket.id);

  // Screen listeners (for frontend clients)
  socket.on('screen1', (data: any) => {
    console.log('Received from screen1:', data);
  });

  socket.on('screen2', (data: any) => {
    console.log('Received from screen2:', data);
  });

  // Controller listeners (for status control)

});

// Helper to log API name to MongoDB
async function insertOne({name}: {name : string}) {
  if (!db) return;
  await db.collection(COLLECTION_NAME).insertOne({ name, timestamp: new Date() });
}

// API for screen 1
app.post('/api/screen1', async (req: express.Request, res: express.Response) => {
  const data = req.body;
  isScreen1Busy = true;
  io.emit('screen1',data);
  // Also update status via controller listener for API
  io.emit('controller1', { isScreen1Busy });
  await insertOne(data);
  res.json({ status: 'sent to screen1', data, isScreen1Busy });
});

// API for screen 2
app.post('/api/screen2', async (req: express.Request, res: express.Response) => {
  const data = req.body;
  isScreen2Busy = true;
  io.emit('screen2', data );
  io.emit('controller2', { isScreen2Busy });
  await insertOne(data);
  res.json({ status: 'sent to screen2', data, isScreen2Busy });
});

app.post('/api/resetScreens', (req: express.Request, res: express.Response) => {
  const { screen1, screen2 } = req.body;
  if (screen1 === true){
    isScreen1Busy = false;
    io.emit('controller1', { isScreen1Busy });
    res.json({ status: 'reset', isScreen1Busy, isScreen2Busy });
  }
    if (screen2 === true) {
      isScreen2Busy = false;
      io.emit('controller2', { isScreen2Busy });
      res.json({ status: 'reset', isScreen1Busy, isScreen2Busy });
    }

  if (screen1 !== true && screen2 !== true) {
    res.json({ status: 'no screens reset', isScreen1Busy, isScreen2Busy });
  }
});


const PORT: number = Number(process.env.PORT) || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});