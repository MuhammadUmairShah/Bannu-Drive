import complaintModel from "./complaint.model.js";
import rideModel from "../rides/ride.model.js";
import deliveryModel from "../deliveries/delivery.model.js";
import { createNotification } from "../notifications/notification.service.js";
import { str, escapeRegex } from "../../shared/utils/objectId.js";

const STATUSES = ["pending", "in_review", "resolved", "rejected"];
const PRIORITIES = ["low", "medium", "high"];

const serverError = (res, label, error) => {
  console.error(`${label}:`, error);
  return res.status(500).json({ success: false, message: "Something went wrong" });
};

// ==========================================
// CUSTOMER - SUBMIT COMPLAINT
// ==========================================
export async function submitComplaint(req, res) {
  try {
    const subject = str(req.body.subject, 120);
    const description = str(req.body.description, 1000);
    const serviceType = str(req.body.serviceType, 12);
    const serviceId = str(req.body.serviceId, 30);
    const priority = str(req.body.priority, 10).toLowerCase() || "medium";

    if (!subject || !description) {
      return res.status(400).json({ success: false, message: "Subject and description are required" });
    }

    if (!PRIORITIES.includes(priority)) {
      return res.status(400).json({ success: false, message: "Invalid priority" });
    }

    let type = "general";
    let relatedId = null;
    let label = "";

    if (serviceId) {
      if (!["ride", "delivery"].includes(serviceType)) {
        return res.status(400).json({ success: false, message: "Invalid service type for the selected trip" });
      }

      const Model = serviceType === "ride" ? rideModel : deliveryModel;
      const service = /^[a-fA-F0-9]{24}$/.test(serviceId) ? await Model.findById(serviceId) : null;

      // A customer can only complain about their own trips
      if (!service || service.customer.toString() !== req.user.id) {
        return res.status(404).json({ success: false, message: "Related trip not found" });
      }

      type = serviceType;
      relatedId = service._id;
      label = `${serviceType === "ride" ? "Ride" : "Delivery"}: ${service.pickupLocation} → ${service.destination}`;
    }

    const complaint = await complaintModel.create({
      customer: req.user.id,
      serviceType: type,
      serviceId: relatedId,
      serviceLabel: label,
      subject,
      description,
      priority,
      status: "pending"
    });

    return res.status(201).json({ success: true, message: "Complaint submitted successfully", complaint });
  } catch (error) {
    return serverError(res, "Submit Complaint Error", error);
  }
}

// ==========================================
// CUSTOMER - MY COMPLAINTS
// ==========================================
export async function getMyComplaints(req, res) {
  try {
    const filter = { customer: req.user.id };
    const status = str(req.query.status, 12);
    if (STATUSES.includes(status)) filter.status = status;

    const complaints = await complaintModel.find(filter).sort({ createdAt: -1 });

    return res.json({ success: true, complaints });
  } catch (error) {
    return serverError(res, "Get My Complaints Error", error);
  }
}

// ==========================================
// ADMIN - GET ALL COMPLAINTS (status / priority / search filters)
// ==========================================
export async function getAllComplaints(req, res) {
  try {
    const filter = {};

    const status = str(req.query.status, 12);
    const priority = str(req.query.priority, 10);
    const q = str(req.query.q, 60);

    if (STATUSES.includes(status)) filter.status = status;
    if (PRIORITIES.includes(priority)) filter.priority = priority;
    if (q) {
      const rx = new RegExp(escapeRegex(q), "i");
      filter.$or = [{ subject: rx }, { description: rx }, { serviceLabel: rx }];
    }

    const complaints = await complaintModel
      .find(filter)
      .populate("customer", "name email phone")
      .sort({ createdAt: -1 })
      .limit(300);

    return res.json({ success: true, complaints });
  } catch (error) {
    return serverError(res, "Get All Complaints Error", error);
  }
}

// ==========================================
// ADMIN - UPDATE COMPLAINT STATUS (+ optional response)
// ==========================================
export async function updateComplaintStatus(req, res) {
  try {
    const status = str(req.body.status, 12);
    const hasResponse = typeof req.body.adminResponse === "string";
    const adminResponse = str(req.body.adminResponse, 1000);

    if (!STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status" });
    }

    const update = { status };

    if (hasResponse) {
      update.adminResponse = adminResponse;
      update.respondedAt = adminResponse ? new Date() : null;
    }

    const complaint = await complaintModel.findByIdAndUpdate(req.params.complaintId, update, { new: true });

    if (!complaint) {
      return res.status(404).json({ success: false, message: "Complaint not found" });
    }

    await createNotification(complaint.customer, {
      type: "complaint_updated",
      title: "Complaint Updated",
      message: `Your complaint "${complaint.subject}" is now ${status.replace("_", " ")}.`.slice(0, 400),
      serviceType: "complaint",
      serviceId: complaint._id
    });

    return res.json({ success: true, message: "Complaint updated successfully", complaint });
  } catch (error) {
    return serverError(res, "Update Complaint Status Error", error);
  }
}
