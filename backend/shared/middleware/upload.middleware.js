import multer from "multer";

const MAX_SIZE = 3 * 1024 * 1024; // 3 MB
const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

const upload = multer({
  storage: multer.memoryStorage(), // nothing is written to disk
  limits: { fileSize: MAX_SIZE, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED.includes(file.mimetype)) {
      const err = new Error("Only JPG, PNG or WEBP images are allowed");
      err.code = "INVALID_FILE_TYPE";
      return cb(err);
    }
    cb(null, true);
  }
});

// Verifies the real file signature, not only the client supplied mimetype
function hasImageSignature(buf) {
  if (!buf || buf.length < 12) return false;
  const jpg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const png = buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const webp = buf.slice(0, 4).toString("ascii") === "RIFF" && buf.slice(8, 12).toString("ascii") === "WEBP";
  return jpg || png || webp;
}

export function uploadProfileImage(req, res, next) {
  upload.single("image")(req, res, (err) => {
    if (err) {
      const message =
        err.code === "LIMIT_FILE_SIZE"
          ? "Image is too large. Maximum size is 3 MB"
          : err.code === "INVALID_FILE_TYPE"
          ? err.message
          : "Invalid upload";
      return res.status(400).json({ success: false, message });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: "Please choose an image" });
    }

    if (!hasImageSignature(req.file.buffer)) {
      return res.status(400).json({ success: false, message: "File is not a valid image" });
    }

    next();
  });
}

// ---------------------------------------------------------------------------
// Verification documents: JPG / PNG / WEBP images or a PDF, up to 5 MB. Checks the declared mimetype,
// the real file signature, a sane extension, and (for images) the pixel dimensions.
// ---------------------------------------------------------------------------
import { MAX_DOC_BYTES, ALLOWED_DOC_MIME, MAX_IMAGE_DIMENSION } from "../../modules/verification/verification.config.js";
import { imageSize } from "../utils/imageSize.js";

const docUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_DOC_BYTES, files: 1, fields: 5, fieldSize: 200 },
  fileFilter: (req, file, cb) => {
    const okMime = ALLOWED_DOC_MIME.includes(file.mimetype);
    const okExt = /\.(jpe?g|png|webp|pdf)$/i.test(file.originalname || "");
    if (!okMime || !okExt) {
      const err = new Error("Only JPG, PNG, WEBP or PDF files are allowed");
      err.code = "INVALID_FILE_TYPE";
      return cb(err);
    }
    cb(null, true);
  }
});

const isPdf = (buf) => buf.length > 8 && buf.slice(0, 5).toString("ascii") === "%PDF-";

export function uploadVerificationDocument(req, res, next) {
  docUpload.single("file")(req, res, (err) => {
    if (err) {
      const message =
        err.code === "LIMIT_FILE_SIZE"
          ? `File is too large. Maximum size is ${MAX_DOC_BYTES / 1024 / 1024} MB`
          : err.code === "INVALID_FILE_TYPE"
          ? err.message
          : "Invalid upload";
      return res.status(400).json({ success: false, message });
    }

    if (!req.file) return res.status(400).json({ success: false, message: "Please choose a file" });

    const buf = req.file.buffer;
    const pdf = isPdf(buf);

    if (req.file.mimetype === "application/pdf") {
      if (!pdf) return res.status(400).json({ success: false, message: "File is not a valid PDF" });
    } else {
      if (pdf || !hasImageSignature(buf)) return res.status(400).json({ success: false, message: "File is not a valid image" });

      const size = imageSize(buf);
      if (!size || size.width < 200 || size.height < 200) {
        return res.status(400).json({ success: false, message: "Image is too small or unreadable. Please upload a clearer photo (at least 200×200 px)." });
      }
      if (size.width > MAX_IMAGE_DIMENSION || size.height > MAX_IMAGE_DIMENSION) {
        return res.status(400).json({ success: false, message: "Image dimensions are too large" });
      }
    }

    next();
  });
}
