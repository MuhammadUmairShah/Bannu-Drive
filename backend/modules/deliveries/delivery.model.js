import mongoose from "mongoose";

const deliverySchema = new mongoose.Schema(
  {
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    driver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    pickupLocation: {
      type: String,
      required: true,
    },

    destination: {
      type: String,
      required: true,
    },

    receiverName: {
      type: String,
      required: true,
    },

    receiverPhone: {
      type: String,
      required: true,
    },

    packageDescription: {
      type: String,
      required: true,
      trim: true,
      maxlength: 300,
    },

    parcelType: {
      type: String,
      enum: [
        "document",
        "food",
        "clothes",
        "electronics",
        "grocery",
        "other",
      ],
      default: "other",
    },

    parcelSize: {
      type: String,
      enum: ["small", "medium", "large"],
      default: "small",
    },

    pickupCoords: {
      latitude: {
        type: Number,
        default: null,
      },
      longitude: {
        type: Number,
        default: null,
      },
    },

    destinationCoords: {
      latitude: {
        type: Number,
        default: null,
      },
      longitude: {
        type: Number,
        default: null,
      },
    },

    distanceKm: {
      type: Number,
      default: null,
    },

    durationMin: {
      type: Number,
      default: null,
    },

    estimatedFare: {
      type: Number,
      default: null,
    },

    notes: {
      type: String,
      default: "",
      trim: true,
      maxlength: 300,
    },

    offeredFare: {
      type: Number,
      required: true,
    },

    status: {
      type: String,
      enum: [
        "pending",
        "accepted",
        "started",
        "completed",
        "cancelled",
      ],
      default: "pending",
    },

    activeCustomer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    activeDriver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    cancelReason: {
      type: String,
      default: "",
      trim: true,
      maxlength: 200,
    },

    cancelledBy: {
      type: String,
      enum: ["customer", "driver", "admin", ""],
      default: "",
    },

    acceptedAt: {
      type: Date,
      default: null,
    },

    startedAt: {
      type: Date,
      default: null,
    },

    completedAt: {
      type: Date,
      default: null,
    },

    cancelledAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,

    toJSON: {
      transform: (doc, ret) => {
        delete ret.activeCustomer;
        delete ret.activeDriver;

        return ret;
      },
    },

    toObject: {
      transform: (doc, ret) => {
        delete ret.activeCustomer;
        delete ret.activeDriver;

        return ret;
      },
    },
  }
);

/*
|--------------------------------------------------------------------------
| ACTIVE TRIP LOCKS
|--------------------------------------------------------------------------
|
| These prevent a customer or driver from having multiple active trips.
|
*/

deliverySchema.index(
  { activeCustomer: 1 },
  {
    unique: true,
    sparse: true,
  }
);

deliverySchema.index(
  { activeDriver: 1 },
  {
    unique: true,
    sparse: true,
  }
);

/*
|--------------------------------------------------------------------------
| AVAILABLE DELIVERY REQUESTS
|--------------------------------------------------------------------------
|
| Useful for:
|
| status = pending
| sort by newest
|
*/

deliverySchema.index({
  status: 1,
  createdAt: -1,
});

/*
|--------------------------------------------------------------------------
| CUSTOMER QUERIES
|--------------------------------------------------------------------------
|
| Used by:
|
| getMyDeliveries()
| history()
|
| Query pattern:
|
| customer + status
| sort createdAt DESC
|
*/

deliverySchema.index({
  customer: 1,
  status: 1,
  createdAt: -1,
});

/*
|--------------------------------------------------------------------------
| DRIVER QUERIES
|--------------------------------------------------------------------------
|
| Used by:
|
| driver active delivery
| driver history
|
*/

deliverySchema.index({
  driver: 1,
  status: 1,
  createdAt: -1,
});

const deliveryModel = mongoose.model(
  "Delivery",
  deliverySchema
);

export default deliveryModel;