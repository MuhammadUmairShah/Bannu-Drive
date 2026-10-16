import mongoose from "mongoose";

const ratingSchema = new mongoose.Schema(
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

    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5
    },

    review: {
      type: String,
      default: ""
    }
  },
  {
    timestamps: true
  }
);

// A service can only be rated once
ratingSchema.index({ serviceType: 1, serviceId: 1 }, { unique: true });

const ratingModel = mongoose.model("Rating", ratingSchema);

export default ratingModel;
