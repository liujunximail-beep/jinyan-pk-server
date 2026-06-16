const express = require("express");
const app = express();
app.use(express.json());
app.get("/api/health", (req, res) => res.json({ok:true}));
app.post("/api/test", (req, res) => {
  console.log("POST /api/test received:", JSON.stringify(req.body));
  res.json({received: req.body});
});
app.post("/api/login", (req, res) => {
  console.log("LOGIN body:", JSON.stringify(req.body));
  const { username, password, mode } = req.body || {};
  if (!username) return res.status(400).json({error: "missing username"});
  res.json({token: "test_token", session: {type:"coach", name:"test"}});
});
const PORT = process.env.PORT || 3006;
app.listen(PORT, () => console.log("Test server on port " + PORT));
