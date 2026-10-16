import mongoose from "mongoose";

const complaintSchema = new mongoose.Schema(
  {
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },

    serviceType: {
      type: String,
      enum: ["ride", "delivery", "general"],
      default: "general"
    },

    serviceId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null
    },

    serviceLabel: {
      type: String,
      default: ""
    },

    subject: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120
    },

    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000
    },

    priority: {
      type: String,
      enum: ["low", "medium", "high"],
      default: "medium"
    },

    adminResponse: {
      type: String,
      default: "",
      trim: true,
      maxlength: 1000
    },

    respondedAt: {
      type: Date,
      default: null
    },

    status: {
      type: String,
      enum: ["pending", "in_review", "resolved", "rejected"],
      default: "pending"
    }
  },
  {
    timestamps: true
  }
);

complaintSchema.index({ customer: 1, createdAt: -1 });
complaintSchema.index({ status: 1, createdAt: -1 });

const complaintModel = mongoose.model("Complaint", complaintSchema);

export default complaintModel;
