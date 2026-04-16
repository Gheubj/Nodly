import { createReadStream, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Express, NextFunction, Request, Response } from "express";
import multer from "multer";
import { authRequired, adminRequired, type AuthenticatedRequest } from "./auth.js";

function lessonImagesDir() {
  return path.join(process.cwd(), "data", "uploads", "lesson-images");
}

function extForMime(mimetype: string): string {
  if (mimetype === "image/png") {
    return ".png";
  }
  if (mimetype === "image/jpeg" || mimetype === "image/jpg") {
    return ".jpg";
  }
  if (mimetype === "image/webp") {
    return ".webp";
  }
  if (mimetype === "image/gif") {
    return ".gif";
  }
  return ".bin";
}

function isSafeImageFilename(name: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|jpeg|webp|gif)$/i.test(name);
}

export function registerLessonImageUploadRoutes(app: Express) {
  mkdirSync(lessonImagesDir(), { recursive: true });

  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, lessonImagesDir()),
    filename: (_req, file, cb) => {
      cb(null, `${randomUUID()}${extForMime(file.mimetype)}`);
    }
  });

  const upload = multer({
    storage,
    limits: { fileSize: 8 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const ok =
        file.mimetype === "image/png" ||
        file.mimetype === "image/jpeg" ||
        file.mimetype === "image/webp" ||
        file.mimetype === "image/gif";
      if (!ok) {
        cb(new Error("Нужен PNG, JPEG, WebP или GIF"));
        return;
      }
      cb(null, true);
    }
  });

  const runUpload = (req: Request, res: Response, next: NextFunction) => {
    upload.single("image")(req, res, (err: unknown) => {
      if (err) {
        const code =
          typeof err === "object" && err !== null && "code" in err ? String((err as { code: unknown }).code) : "";
        if (code === "LIMIT_FILE_SIZE") {
          res.status(400).json({ error: "Файл больше 8 МБ" });
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
    "/api/admin/uploads/lesson-image",
    authRequired,
    adminRequired,
    runUpload,
    (req: AuthenticatedRequest, res: Response) => {
      const file = (req as Request & { file?: Express.Multer.File }).file;
      if (!file?.filename) {
        res.status(400).json({ error: "Прикрепите изображение в поле image" });
        return;
      }
      const url = `/api/uploads/lesson-images/${file.filename}`;
      res.json({ url });
    }
  );

  app.get("/api/uploads/lesson-images/:filename", (req: Request, res: Response) => {
    const filename = String(req.params.filename ?? "");
    if (!isSafeImageFilename(filename)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const filePath = path.join(lessonImagesDir(), filename);
    if (!existsSync(filePath)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const lower = filename.toLowerCase();
    const type = lower.endsWith(".png")
      ? "image/png"
      : lower.endsWith(".webp")
        ? "image/webp"
        : lower.endsWith(".gif")
          ? "image/gif"
          : "image/jpeg";
    res.setHeader("Content-Type", type);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "public, max-age=3600");
    createReadStream(filePath).pipe(res);
  });
}
