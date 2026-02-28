import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";

const port = parseInt(process.env.VIBMA_PORT || "3055");

// Store clients by channel
const channels = new Map<string, Set<WebSocket>>();

const httpServer = createServer((req, res) => {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("WebSocket server running");
});

const wss = new WebSocketServer({ server: httpServer });

const HEARTBEAT_INTERVAL = 15_000;
const aliveClients = new WeakSet<WebSocket>();

const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!aliveClients.has(ws)) return ws.terminate();
    aliveClients.delete(ws);
    ws.ping();
  });
}, HEARTBEAT_INTERVAL);

wss.on("close", () => clearInterval(heartbeat));

wss.on("connection", (ws: WebSocket) => {
  console.log("New client connected");
  aliveClients.add(ws);
  ws.on("pong", () => aliveClients.add(ws));

  // Send welcome message to the new client
  ws.send(JSON.stringify({
    type: "system",
    message: "Please join a channel to start chatting",
  }));

  ws.on("message", (raw: Buffer | string) => {
    try {
      const message = raw.toString();
      console.log("Received message from client:", message);
      const data = JSON.parse(message);

      if (data.type === "join") {
        const channelName = data.channel;
        if (!channelName || typeof channelName !== "string") {
          ws.send(JSON.stringify({
            type: "error",
            message: "Channel name is required"
          }));
          return;
        }

        // Create channel if it doesn't exist
        if (!channels.has(channelName)) {
          channels.set(channelName, new Set());
        }

        // Add client to channel
        const channelClients = channels.get(channelName)!;
        channelClients.add(ws);

        // Notify client they joined successfully
        ws.send(JSON.stringify({
          type: "system",
          message: `Joined channel: ${channelName}`,
          channel: channelName
        }));

        console.log("Sending message to client:", data.id);

        ws.send(JSON.stringify({
          type: "system",
          message: {
            id: data.id,
            result: "Connected to channel: " + channelName,
          },
          channel: channelName
        }));

        // Notify other clients in channel
        channelClients.forEach((client) => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
              type: "system",
              message: "A new user has joined the channel",
              channel: channelName
            }));
          }
        });
        return;
      }

      if (data.type === "message" || data.type === "progress_update") {
        const channelName = data.channel;
        if (!channelName || typeof channelName !== "string") {
          ws.send(JSON.stringify({
            type: "error",
            message: "Channel name is required"
          }));
          return;
        }

        const channelClients = channels.get(channelName);
        if (!channelClients || !channelClients.has(ws)) {
          ws.send(JSON.stringify({
            type: "error",
            message: "You must join the channel first"
          }));
          return;
        }

        channelClients.forEach((client) => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            console.log("Broadcasting message to client:", data.message);
            client.send(JSON.stringify({
              type: "broadcast",
              message: data.message,
              sender: "User",
              channel: channelName
            }));
          }
        });
      }
    } catch (err) {
      console.error("Error handling message:", err);
    }
  });

  ws.on("close", () => {
    console.log("Client disconnected");

    // Remove client from their channel and notify others
    channels.forEach((clients, channelName) => {
      if (clients.has(ws)) {
        clients.delete(ws);

        if (clients.size === 0) {
          channels.delete(channelName);
          return;
        }

        clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
              type: "system",
              message: "A user has left the channel",
              channel: channelName
            }));
          }
        });
      }
    });
  });
});

// uncomment this to allow connections in windows wsl
// httpServer.listen(port, "0.0.0.0", () => {
httpServer.listen(port, () => {
  console.log(`WebSocket server running on port ${port}`);
});
