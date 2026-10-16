import mongoose from "mongoose";

const rideSchema = new mongoose.Schema(
  {
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },

    driver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    },

    pickupLocation: {
      type: String,
      required: true
    },

    destination: {
      type: String,
      required: true
    },

    vehicleType: {
      type: String,
      required: true
    },

    pickupCoords: {
      latitude: { type: Number, default: null },
      longitude: { type: Number, default: null }
    },

    destinationCoords: {
      latitude: { type: Number, default: null },
      longitude: { type: Number, default: null }
    },

    distanceKm: {
      type: Number,
      default: null
    },

    durationMin: {
      type: Number,
      default: null
    },

    estimatedFare: {
      type: Number,
      default: null
    },

    notes: {
      type: String,
      default: "",
      trim: true,
      maxlength: 300
    },

    offeredFare: {
      type: Number,
      required: true
    },

    status: {
      type: String,
      enum: ["pending", "accepted", "started", "completed", "cancelled"],
      default: "pending"
    },

    // Lock fields: present ONLY while the booking is active. A sparse unique index on each
    // makes MongoDB itself refuse a second active booking (works on a standalone server,
    // no replica set / transaction needed). They are $unset on complete / cancel.
    activeCustomer: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    activeDriver: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    // Fare finally agreed (the chosen driver's offer). Falls back to offeredFare for older rides.
    agreedFare: { type: Number, default: null },
    arrivedAt: { type: Date, default: null },
    cancelReason: { type: String, default: "", trim: true, maxlength: 200 },
    cancelledBy: { type: String, enum: ["customer", "driver", "admin", ""], default: "" },

    acceptedAt: { type: Date, default: null },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null }
  },
  {
    timestamps: true,
    // internal lock fields never leave the server
    toJSON: { transform: (doc, ret) => { delete ret.activeCustomer; delete ret.activeDriver; return ret; } },
    toObject: { transform: (doc, ret) => { delete ret.activeCustomer; delete ret.activeDriver; return ret; } }
  }
);

rideSchema.index({ activeCustomer: 1 }, { unique: true, sparse: true });
rideSchema.index({ activeDriver: 1 }, { unique: true, sparse: true });
rideSchema.index({ status: 1, createdAt: -1 });
rideSchema.index({ customer: 1, status: 1 });
rideSchema.index({ driver: 1, status: 1 });

const rideModel = mongoose.model("Ride", rideSchema);

export default rideModel;