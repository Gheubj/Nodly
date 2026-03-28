import cors from "cors";
import express from "express";
import type { Request, Response } from "express";

const app = express();
const port = 3001;

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ ok: true, service: "noda-poc-server" });
});

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Server started at http://localhost:${port}`);
});
