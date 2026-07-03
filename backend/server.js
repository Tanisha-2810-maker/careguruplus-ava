require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { safetyFilter } = require("./middleware/safetyFilter");
const chatRouter = require("./routes/chat");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/", (req, res) => {
  res.json({
    status: "Ava backend running ✅",
    chat_endpoint: "/chat",
    note: "POST { message, session_id, consent } to /chat"
  });
});

app.use("/chat", safetyFilter);
app.use("/chat", chatRouter);

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`Ava backend listening on port ${PORT}`);
});

server.on("error", err => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Close the old server or change PORT in .env.`);
  } else {
    console.error("Server error:", err.message);
  }
  process.exit(1);
});

module.exports = app;
