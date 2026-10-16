import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    // Google-only accounts get an unusable random hash (see passwordSet)
    password: {
      type: String,
      required: true,
    },

    // false = the account has no password the owner knows (Google sign-in, or password wiped when linking)
    passwordSet: { type: Boolean, default: true },

    // Phone is mandatory for password sign-ups; Google sign-ups add it later from the profile.
    // Uniqueness is enforced by the partial index below (empty phones never collide).
    phone: {
      type: String,
      default: "",
      trim: true,
    },

    // Google identity (the OpenID "sub" claim). Never trusted from the frontend: set only after the
    // backend verified the ID token.
    googleId: { type: String, default: undefined, select: false },
    emailVerified: { type: Boolean, default: false },

    role: {
      type: String,
      enum: ["customer", "driver", "operator", "admin"],
      default: "customer",
    },

    // Cloudinary secure URL (only the URL + public id are stored, never image data)
    profileImage: {
      type: String,
      default: "",
    },

    profileImagePublicId: {
      type: String,
      default: "",
      select: false,
    },

    isVerified: {
      type: Boolean,
      default: false,
    },

    isBlocked: {
      type: Boolean,
      default: false,
    },

    vehicleType: {
      type: String,
      default: "",
    },

    // Password reset: only a SHA-256 hash of the emailed token is stored
    resetTokenHash: { type: String, default: "", select: false },
    resetTokenExpires: { type: Date, default: null, select: false },

    vehicleModel: {
      type: String,
      default: "",
      trim: true,
    },

    vehicleNumber: {
      type: String,
      default: "",
    },

    licenseNumber: {
      type: String,
      default: "",
    },

    currentLocation: {
      latitude: { type: Number, default: null },
      longitude: { type: Number, default: null },
      accuracy: { type: Number, default: null },
      updatedAt: { type: Date, default: null },
    },

    driverStatus: {
      type: String,
      enum: ["offline", "online", "busy"],
      default: "offline",
    },
  },
  {
    timestamps: true,
  }
);

userSchema.index({ phone: 1 }, { unique: true, partialFilterExpression: { phone: { $type: "string", $gt: "" } } });
userSchema.index({ googleId: 1 }, { unique: true, partialFilterExpression: { googleId: { $type: "string" } } });
userSchema.index({ role: 1, driverStatus: 1, isVerified: 1 });
userSchema.index({ role: 1, createdAt: -1 });

const userModel = mongoose.model("User", userSchema);

export default userModel;