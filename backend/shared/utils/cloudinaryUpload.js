import cloudinary from "../config/cloudinary.js";
import { cloudinaryConfigured } from "../config/env.js";

// Reusable: upload an in-memory image buffer, returns { url, publicId }
export function uploadImageBuffer(buffer, { folder = "safarx-bannu/profiles" } = {}) {
  return new Promise((resolve, reject) => {
    if (!cloudinaryConfigured()) {
      const err = new Error("CLOUDINARY_NOT_CONFIGURED");
      err.code = "CLOUDINARY_NOT_CONFIGURED";
      return reject(err);
    }

    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: "image",
        allowed_formats: ["jpg", "jpeg", "png", "webp"],
        transformation: [
          { width: 512, height: 512, crop: "fill", gravity: "face" },
          { quality: "auto", fetch_format: "auto" }
        ]
      },
      (error, result) => {
        if (error) return reject(error);
        resolve({ url: result.secure_url, publicId: result.public_id });
      }
    );

    stream.end(buffer);
  });
}

// Best effort delete: a failed cleanup must never block the user
export async function deleteImage(publicId) {
  if (!publicId || !cloudinaryConfigured()) return false;

  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: "image", invalidate: true });
    return true;
  } catch (error) {
    console.error("Cloudinary delete failed:", error.message);
    return false;
  }
}

// ---------------------------------------------------------------------------
// PRIVATE documents (CNIC, licences, permits...). Uploaded with type "authenticated": Cloudinary will
// refuse every plain/guessable URL. Files are only readable by the backend, which streams them to
// the owner or an admin after an authorization check. No document URL is ever sent to a browser.
// ---------------------------------------------------------------------------
export function uploadPrivateBuffer(buffer, { folder, resourceType = "image" } = {}) {
  return new Promise((resolve, reject) => {
    if (!cloudinaryConfigured()) {
      const err = new Error("CLOUDINARY_NOT_CONFIGURED");
      err.code = "CLOUDINARY_NOT_CONFIGURED";
      return reject(err);
    }

    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: resourceType, // PDFs are handled under "image" by Cloudinary
        type: "authenticated",
        allowed_formats: ["jpg", "jpeg", "png", "webp", "pdf"],
        unique_filename: true,
        overwrite: false
      },
      (error, result) => {
        if (error) return reject(error);
        resolve({ publicId: result.public_id, format: result.format || "", resourceType: result.resource_type || resourceType });
      }
    );

    stream.end(buffer);
  });
}

// Fetches a private file server-side through a 60-second signed download URL that never leaves the backend.
export async function fetchPrivateFile(publicId, format, resourceType = "image") {
  if (!cloudinaryConfigured()) {
    const err = new Error("CLOUDINARY_NOT_CONFIGURED");
    err.code = "CLOUDINARY_NOT_CONFIGURED";
    throw err;
  }

  const url = cloudinary.utils.private_download_url(publicId, format, {
    resource_type: resourceType,
    type: "authenticated",
    expires_at: Math.floor(Date.now() / 1000) + 60
  });

  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Storage responded ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
