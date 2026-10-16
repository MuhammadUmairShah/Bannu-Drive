import userModel from "../../modules/users/user.model.js";
import rideModel from "../../modules/rides/ride.model.js";
import deliveryModel from "../../modules/deliveries/delivery.model.js";

// ==========================================
// Does this driver currently hold an accepted / started job?
// ==========================================
export async function driverHasActiveJob(driverId) {
  const [ride, delivery] = await Promise.all([
    rideModel.exists({ driver: driverId, status: { $in: ["accepted", "started"] } }),
    deliveryModel.exists({ driver: driverId, status: { $in: ["accepted", "started"] } })
  ]);

  return !!(ride || delivery);
}

// ==========================================
// Central matching rules: can this driver see / accept jobs right now?
// Returns { ok, status, message, driver }
// ==========================================
export async function checkDriverEligibility(driverId, { requireIdle = false } = {}) {
  const driver = await userModel.findById(driverId);

  if (!driver || driver.role !== "driver") {
    return { ok: false, status: 403, message: "Driver account required" };
  }

  if (driver.isBlocked) {
    return { ok: false, status: 403, message: "Your account is blocked" };
  }

  if (!driver.isVerified) {
    return {
      ok: false,
      status: 403,
      message: "Your account is pending admin verification"
    };
  }

  if (driver.driverStatus !== "online") {
    return { ok: false, status: 403, message: "Go online to view or accept requests" };
  }

  if (requireIdle && (await driverHasActiveJob(driverId))) {
    return {
      ok: false,
      status: 409,
      message: "Finish your current trip before accepting another request"
    };
  }

  return { ok: true, driver };
}
