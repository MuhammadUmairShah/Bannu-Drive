import transactionModel, { settingsModel } from "./payment.model.js";
import { sumField } from "../../shared/utils/aggregate.js";
import { buildTripData, getPlatformSettings } from "../../shared/utils/trip.js";

// ==========================================
// INTERNAL HELPER - get (or create) commission settings
// ==========================================
export async function getCommissionPercentage() {
  let settings = await settingsModel.findOne();

  if (!settings) {
    settings = await settingsModel.create({ commissionPercentage: 15 });
  }

  return settings.commissionPercentage;
}


// ==========================================
// INTERNAL HELPER - called when a ride/delivery is completed
// ==========================================
export async function recordTransaction({ serviceType, serviceId, customer, driver, fare, routeLabel = "" }) {
  try {
    const existing = await transactionModel.findOne({ serviceType, serviceId });

    if (existing) {
      return existing;
    }

    const commissionPercentage = await getCommissionPercentage();
    const commissionAmount = Math.round((fare * commissionPercentage) / 100);
    const driverEarning = fare - commissionAmount;

    const transaction = await transactionModel.create({
      serviceType,
      serviceId,
      customer,
      driver,
      routeLabel,
      fare,
      commissionPercentage,
      commissionAmount,
      driverEarning
    });

    return transaction;

  } catch (error) {
    console.log("Record Transaction Error:", error);
    return null;
  }
}


// ==========================================
// SETTINGS SHAPE HELPER
// ==========================================
function settingsPayload(settings) {
  return {
    commissionPercentage: settings.commissionPercentage,
    fare: {
      baseFare: settings.baseFare,
      perKmRate: settings.perKmRate,
      minimumFare: settings.minimumFare,
      multipliers: {
        bike: settings.multipliers.bike,
        rickshaw: settings.multipliers.rickshaw,
        car: settings.multipliers.car,
        delivery: settings.multipliers.delivery
      }
    }
  };
}


// ==========================================
// ADMIN - GET PLATFORM SETTINGS (commission + fare)
// ==========================================
export async function getSettings(req, res) {
  try {
    const settings = await getPlatformSettings();

    return res.json({
      success: true,
      ...settingsPayload(settings)
    });

  } catch (error) {
    console.log("Get Settings Error:", error);

    return res.status(500).json({
      success: false,
      message: "Something went wrong"
    });
  }
}


// ==========================================
// ADMIN - UPDATE PLATFORM SETTINGS
// Accepts any of: commissionPercentage, baseFare, perKmRate,
// minimumFare, multipliers { bike, rickshaw, car, delivery }
// ==========================================
export async function updateSettings(req, res) {
  try {
    const { commissionPercentage, baseFare, perKmRate, minimumFare, multipliers } = req.body;

    const settings = await getPlatformSettings();

    if (commissionPercentage !== undefined) {
      const value = Number(commissionPercentage);

      if (!Number.isFinite(value) || value < 0 || value > 100) {
        return res.status(400).json({
          success: false,
          message: "Commission percentage must be between 0 and 100"
        });
      }

      settings.commissionPercentage = value;
    }

    const numericFields = { baseFare, perKmRate, minimumFare };

    for (const [key, raw] of Object.entries(numericFields)) {
      if (raw === undefined) continue;

      const value = Number(raw);

      if (!Number.isFinite(value) || value < 0) {
        return res.status(400).json({
          success: false,
          message: `${key} must be a non-negative number`
        });
      }

      settings[key] = value;
    }

    if (multipliers) {
      for (const key of ["bike", "rickshaw", "car", "delivery"]) {
        if (multipliers[key] === undefined) continue;

        const value = Number(multipliers[key]);

        if (!Number.isFinite(value) || value < 0.1 || value > 10) {
          return res.status(400).json({
            success: false,
            message: `${key} multiplier must be between 0.1 and 10`
          });
        }

        settings.multipliers[key] = value;
      }
    }

    await settings.save();

    return res.json({
      success: true,
      message: "Settings updated successfully",
      ...settingsPayload(settings)
    });

  } catch (error) {
    console.log("Update Settings Error:", error);

    return res.status(500).json({
      success: false,
      message: "Something went wrong"
    });
  }
}


// ==========================================
// CUSTOMER - FARE ESTIMATE (authoritative, computed on backend)
// body: { pickupCoords, destinationCoords, distanceKm?, durationMin?, kind }
// kind: bike | rickshaw | car | delivery
// ==========================================
export async function estimateFare(req, res) {
  try {
    const { kind } = req.body;

    if (!["bike", "rickshaw", "car", "delivery"].includes(kind)) {
      return res.status(400).json({
        success: false,
        message: "Invalid vehicle/service type"
      });
    }

    const trip = await buildTripData(req.body, kind);

    if (trip.error) {
      return res.status(400).json({
        success: false,
        message: trip.error
      });
    }

    return res.json({
      success: true,
      distanceKm: trip.data.distanceKm,
      durationMin: trip.data.durationMin,
      estimatedFare: trip.data.estimatedFare
    });

  } catch (error) {
    console.log("Estimate Fare Error:", error);

    return res.status(500).json({
      success: false,
      message: "Something went wrong"
    });
  }
}


// ==========================================
// DRIVER - MY TRANSACTIONS
// ==========================================
export async function getMyTransactions(req, res) {
  try {
    const transactions = await transactionModel
      .find({ driver: req.user.id })
      .sort({ createdAt: -1 });

    const totalEarning = transactions.reduce((sum, t) => sum + t.driverEarning, 0);
    const totalCommission = transactions.reduce((sum, t) => sum + t.commissionAmount, 0);
    const totalFare = transactions.reduce((sum, t) => sum + t.fare, 0);

    return res.json({
      success: true,
      transactions,
      totalEarning,
      totalCommission,
      totalFare
    });

  } catch (error) {
    console.log("Get My Transactions Error:", error);

    return res.status(500).json({
      success: false,
      message: "Something went wrong"
    });
  }
}


// ==========================================
// ADMIN - ALL TRANSACTIONS
// ==========================================
export async function getAllTransactions(req, res) {
  try {
    const transactions = await transactionModel
      .find({})
      .populate("customer", "name")
      .populate("driver", "name")
      .sort({ createdAt: -1 })
      .limit(500);

    const [totalFare, totalCommission, totalDriverEarnings] = await Promise.all([
      sumField(transactionModel, {}, "fare"),
      sumField(transactionModel, {}, "commissionAmount"),
      sumField(transactionModel, {}, "driverEarning")
    ]);

    return res.json({
      success: true,
      transactions,
      totalCommission,
      totalFare,
      totalDriverEarnings
    });

  } catch (error) {
    console.log("Get All Transactions Error:", error);

    return res.status(500).json({
      success: false,
      message: "Something went wrong"
    });
  }
}
