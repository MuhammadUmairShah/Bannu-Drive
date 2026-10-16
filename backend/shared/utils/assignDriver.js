import tripClaimModel from "../../modules/rides/tripClaim.model.js";

// The ONE place where a driver gets attached to a booking (used by delivery "accept" and by the
// customer choosing a ride offer). Returns { ok:true, doc } or { ok:false, status, message }.
//
//  1. Insert a claim. A UNIQUE index guarantees only one claim per booking, whatever the timing.
//  2. Flip pending -> accepted. activeDriver (unique, sparse) stops a driver holding two jobs.
//  3. Cross-check the other booking collection; undo cleanly if the driver is busy there.
export async function assignDriverToTrip({ Model, OtherModel, serviceType, id, driverId, extraSet = {} }) {
  try {
    await tripClaimModel.create({ serviceType, serviceId: id, driver: driverId });
  } catch (claimError) {
    if (claimError.code === 11000) return { ok: false, status: 409, message: "This request is no longer available" };
    throw claimError;
  }

  let doc;

  try {
    doc = await Model.findOneAndUpdate(
      { _id: id, status: "pending", driver: null },
      { driver: driverId, activeDriver: driverId, status: "accepted", acceptedAt: new Date(), ...extraSet },
      { new: true }
    );
  } catch (error) {
    await tripClaimModel.deleteOne({ serviceType, serviceId: id, driver: driverId });
    if (error.code === 11000) {
      return { ok: false, status: 409, message: "That driver is already on another trip" };
    }
    throw error;
  }

  if (!doc) return { ok: false, status: 409, message: "This request is no longer available" };

  const busyElsewhere = await OtherModel.exists({ driver: driverId, status: { $in: ["accepted", "started"] } });

  if (busyElsewhere) {
    await Model.updateOne(
      { _id: doc._id, driver: driverId, status: "accepted" },
      { $set: { driver: null, status: "pending", acceptedAt: null }, $unset: { activeDriver: 1 } }
    );
    await tripClaimModel.deleteOne({ serviceType, serviceId: doc._id, driver: driverId });
    return { ok: false, status: 409, message: "That driver is already on another trip" };
  }

  return { ok: true, doc };
}
