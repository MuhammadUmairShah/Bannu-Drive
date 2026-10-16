import ratingModel from "./rating.model.js";
import rideModel from "../rides/ride.model.js";
import deliveryModel from "../deliveries/delivery.model.js";
import { str } from "../../shared/utils/objectId.js";
import { getDriverRatingSummary } from "./rating.service.js";

const serviceModels = { ride: rideModel, delivery: deliveryModel };

const serverError = (res, label, error) => {
  console.error(`${label}:`, error);
  return res.status(500).json({ success: false, message: "Something went wrong" });
};

// ==========================================
// CUSTOMER - SUBMIT RATING
// ==========================================
export async function submitRating(req, res) {
  try {
    const serviceType = str(req.body.serviceType, 12);
    const serviceId = str(req.body.serviceId, 30);
    const rating = Number(req.body.rating);
    const review = str(req.body.review, 500);

    if (!serviceType || !serviceId || !req.body.rating) {
      return res.status(400).json({ success: false, message: "serviceType, serviceId and rating are required" });
    }

    if (!["ride", "delivery"].includes(serviceType)) {
      return res.status(400).json({ success: false, message: "Invalid service type" });
    }

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ success: false, message: "Rating must be a whole number between 1 and 5" });
    }

    if (!/^[a-fA-F0-9]{24}$/.test(serviceId)) {
      return res.status(400).json({ success: false, message: "Invalid service id" });
    }

    const service = await serviceModels[serviceType].findById(serviceId);

    // Same message for "missing" and "not yours" so ids cannot be probed
    if (!service || service.customer.toString() !== req.user.id) {
      return res.status(404).json({ success: false, message: "Completed request not found" });
    }

    if (service.status !== "completed" || !service.driver) {
      return res.status(409).json({ success: false, message: "Only completed rides/deliveries can be rated" });
    }

    if (service.driver.toString() === req.user.id) {
      return res.status(403).json({ success: false, message: "You cannot rate yourself" });
    }

    // Unique index (serviceType + serviceId) is the real guard against duplicates
    const newRating = await ratingModel.create({
      serviceType,
      serviceId,
      customer: req.user.id,
      driver: service.driver,
      rating,
      review
    });

    return res.status(201).json({ success: true, message: "Rating submitted successfully", rating: newRating });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: "This request has already been rated" });
    }
    return serverError(res, "Submit Rating Error", error);
  }
}

// ==========================================
// CUSTOMER - GET UNRATED COMPLETED SERVICES
// ==========================================
export async function getRatableServices(req, res) {
  try {
    const [rides, deliveries, existingRatings] = await Promise.all([
      rideModel.find({ customer: req.user.id, status: "completed" }).populate("driver", "name profileImage"),
      deliveryModel.find({ customer: req.user.id, status: "completed" }).populate("driver", "name profileImage"),
      ratingModel.find({ customer: req.user.id }).select("serviceType serviceId")
    ]);

    const rated = new Set(existingRatings.map((r) => `${r.serviceType}-${r.serviceId}`));

    const shape = (type) => (s) => ({
      serviceType: type,
      serviceId: s._id,
      driverName: s.driver?.name || "Driver",
      driverImage: s.driver?.profileImage || "",
      pickupLocation: s.pickupLocation,
      destination: s.destination,
      createdAt: s.createdAt
    });

    const ratable = [
      ...rides.filter((r) => !rated.has(`ride-${r._id}`)).map(shape("ride")),
      ...deliveries.filter((d) => !rated.has(`delivery-${d._id}`)).map(shape("delivery"))
    ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return res.json({ success: true, ratable });
  } catch (error) {
    return serverError(res, "Get Ratable Services Error", error);
  }
}

// ==========================================
// DRIVER - GET RECEIVED RATINGS (summary + recent)
// ==========================================
export async function getReceivedRatings(req, res) {
  try {
    const [ratings, summary] = await Promise.all([
      ratingModel.find({ driver: req.user.id }).populate("customer", "name").sort({ createdAt: -1 }).limit(50),
      getDriverRatingSummary(req.user.id)
    ]);

    return res.json({
      success: true,
      ratings,
      average: summary.average,
      count: summary.count
    });
  } catch (error) {
    return serverError(res, "Get Received Ratings Error", error);
  }
}
