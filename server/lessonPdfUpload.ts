import {
  closeSync,
  createReadStream,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  unlinkSync
} from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Express, NextFunction, Request, Response } from "express";
import multer from "multer";
import { authRequired, adminRequired, type AuthenticatedRequest } from "./auth.js";

const PDF_MAGIC = Buffer.from("%PDF");

function lessonPdfUploadDir() {
  return path.join(process.cwd(), "data", "uploads", "lesson-pdfs");
}

function readPdfMagicPrefix(filePath: string): Buffer {
  const fd = openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(8);
    const n = readSync(fd, buf, 0, 8, 0);
    return buf.subarray(0, n);
  } finally {
    closeSync(fd);
  }
}

/** Имя файла = uuid + .pdf (без path traversal). */
function isSafeLessonPdfFilename(name: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/i.test(name);
}

export function registerLessonPdfUploadRoutes(app: Express) {
  mkdirSync(lessonPdfUploadDir(), { recursive: true });

  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, lessonPdfUploadDir());
    },
    filename: (_req, _file, cb) => {
      cb(null, `${randomUUID()}.pdf`);
    }
  });

  const upload = multer({
    storage,
    limits: { fileSize: 25 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const name = file.originalname.toLowerCase();
      const okMime =
        file.mimetype === "application/pdf" ||
        (file.mimetype === "application/octet-stream" && name.endsWith(".pdf"));
      if (!okMime) {
        cb(new Error("Нужен файл в формате PDF"));
        return;
      }
      cb(null, true);
    }
  });

  const runUpload = (req: Request, res: Response, next: NextFunction) => {
    upload.single("pdf")(req, res, (err: unknown) => {
      if (err) {
        const code = typeof err === "object" && err !== null && "code" in err ? String((err as { code: unknown }).code) : "";
        if (code === "LIMIT_FILE_SIZE") {
          res.status(400).json({ error: "Файл больше 25 МБ" });
          return;
        }
        const msg = err instanceof Error ? err.message : "Ошибка загрузки";
        res.status(400).json({ error: msg });
        return;
      }
      next();
    });
  };

  app.post(
    "/api/admin/uploads/lesson-pdf",
    authRequired,
    adminRequired,
    runUpload,
    (req: AuthenticatedRequest, res: Response) => {
      const file = (req as Request & { file?: Express.Multer.File }).file;
      if (!file?.path) {
        res.status(400).json({ error: "Прикрепите PDF в поле pdf" });
        return;
      }
      try {
        const head = readPdfMagicPrefix(file.path);
        if (head.length < 4 || !head.subarray(0, 4).equals(PDF_MAGIC)) {
          unlinkSync(file.path);
          res.status(400).json({ error: "Файл не похож на PDF" });
          return;
        }
      } catch {
        try {
          unlinkSync(file.path);
        } catch {
          /* ignore */
        }
        res.status(400).json({ error: "Не удалось прочитать файл" });
        return;
      }
      const url = `/api/uploads/lesson-pdfs/${path.basename(file.path)}`;
      res.json({ url });
    }
  );

  app.get("/api/uploads/lesson-pdfs/:filename", (req: Request, res: Response) => {
    const filename = String(req.params.filename ?? "");
    if (!isSafeLessonPdfFilename(filename)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const filePath = path.join(lessonPdfUploadDir(), filename);
    if (!existsSync(filePath)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "public, max-age=3600");
    createReadStream(filePath).pipe(res);
  });
}
