import mongoose from "mongoose";

// ==========================================
// PLATFORM SETTINGS (singleton) - commission %
// ==========================================
const settingsSchema = new mongoose.Schema(
  {
    commissionPercentage: {
      type: Number,
      default: 15,
      min: 0,
      max: 100
    },

    baseFare: {
      type: Number,
      default: 60,
      min: 0
    },

    perKmRate: {
      type: Number,
      default: 30,
      min: 0
    },

    minimumFare: {
      type: Number,
      default: 100,
      min: 0
    },

    multipliers: {
      bike: { type: Number, default: 0.8, min: 0.1 },
      rickshaw: { type: Number, default: 1, min: 0.1 },
      car: { type: Number, default: 1.5, min: 0.1 },
      delivery: { type: Number, default: 0.9, min: 0.1 }
    }
  },
  {
    timestamps: true
  }
);

export const settingsModel = mongoose.model("PlatformSettings", settingsSchema);


// ==========================================
// TRANSACTION - one per completed ride/delivery
// ==========================================
const transactionSchema = new mongoose.Schema(
  {
    serviceType: {
      type: String,
      enum: ["ride", "delivery"],
      required: true
    },

    serviceId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true
    },

    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },

    driver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },

    routeLabel: {
      type: String,
      default: ""
    },

    fare: {
      type: Number,
      required: true
    },

    commissionPercentage: {
      type: Number,
      required: true
    },

    commissionAmount: {
      type: Number,
      required: true
    },

    driverEarning: {
      type: Number,
      required: true
    }
  },
  {
    timestamps: true
  }
);

transactionSchema.index({ serviceType: 1, serviceId: 1 }, { unique: true });

const transactionModel = mongoose.model("Transaction", transactionSchema);

export default transactionModel;
