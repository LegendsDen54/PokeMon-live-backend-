require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { runCheck, getLatest } = require("./monitor");

const app = express();
const port = Number(process.env.PORT || 8080);
const pollSeconds = Math.max(10, Number(process.env.POLL_SECONDS || 30));
const allowedOrigin = process.env.ALLOWED_ORIGIN || "*";

app.use(cors({ origin: allowedOrigin === "*" ? true : allowedOrigin }));
app.use(express.json());

app.get("/", (req, res) => res.json({
  name: "Pokemon Live Monitor Backend",
  ok: true,
  provider: process.env.DATA_PROVIDER || "mock"
}));
app.get("/health", (req, res) => res.json({ ok: true, time: new Date().toISOString() }));
app.get("/api/debug-products", async (req, res) => {

  await runCheck();

  res.json(getLatest());

});
app.get("/api/products", async (req, res) => {
  let data = getLatest();
  if (!data.lastRun) {
    await runCheck();
    data = getLatest();
  }
  const filtered = data.items.filter(item =>
    item.directSeller !== false && item.withinPriceRule !== false
  );
  res.json({ lastRun: data.lastRun, count: filtered.length, items: filtered });
});

app.post("/api/check-now", async (req, res) => {
  await runCheck();
  res.json(getLatest());
});

app.listen(port, async () => {
  console.log(`Pokemon monitor backend listening on ${port}`);
  await runCheck();
  setInterval(runCheck, pollSeconds * 1000);
});
