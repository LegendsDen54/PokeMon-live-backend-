require("dotenv").config();

const express = require("express");
const cors = require("cors");

const { runCheck, getLatest } = require("./monitor");
const walmart = require("./walmart");
const products = require("./products.json");

const app = express();

const port = Number(process.env.PORT || 8080);

const pollSeconds = Math.max(
  10,
  Number(process.env.POLL_SECONDS || 86400)
);

const allowedOrigin =
  process.env.ALLOWED_ORIGIN || "*";

const runOnStartup =
  String(
    process.env.RUN_ON_STARTUP || "false"
  ).toLowerCase() === "true";

app.use(
  cors({
    origin:
      allowedOrigin === "*"
        ? true
        : allowedOrigin
  })
);

app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    name: "Pokemon Live Monitor Backend",
    ok: true,
    provider:
      process.env.DATA_PROVIDER || "mock"
  });
});

app.get("/health", (req, res) => {
 
