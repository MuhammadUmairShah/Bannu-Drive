import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../../utils/api";
import TripMap from "../../components/map/TripMap";
import { getErrorMessage } from "../../utils/errors";
import {
  MapPin,
  User,
  Phone,
  Bike,
  DollarSign,
  Package,
  Play,
  CheckCircle2,
  ArrowLeft
} from "lucide-react";
import { toast } from '../../utils/toast';

export default function ManageTrip() {
  const navigate = useNavigate();

  const [job, setJob] = useState(null); // { type: 'ride' | 'delivery', ...data }
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  async function getActiveJob(silent = false) {
    try {
      if (!silent) setLoading(true);
      setLoadError("");

      const [rideRes, deliveryRes] = await Promise.all([
        api.get("/ride/active"),
        api.get("/delivery/active")
      ]);

      if (rideRes.data.success && rideRes.data.ride) {
        setJob({ type: "ride", ...rideRes.data.ride });
      } else if (deliveryRes.data.success && deliveryRes.data.delivery) {
        setJob({ type: "delivery", ...deliveryRes.data.delivery });
      } else {
        setJob(null);
      }
    } catch (error) {
      if (!silent) {
        setJob(null);
        setLoadError(getErrorMessage(error, "Could not load your active trip"));
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    getActiveJob();

    // Refresh every 15s so a customer cancellation is noticed
    const timer = setInterval(() => getActiveJob(true), 15000);
    return () => clearInterval(timer);
  }, []);

  async function startJob() {
    if (!job) return;

    try {
      setActionLoading(true);

      const endpoint =
        job.type === "ride"
          ? `/ride/start/${job._id}`
          : `/delivery/start/${job._id}`;

      const response = await api.patch(endpoint);

      if (response.data.success) {
        setJob({ type: job.type, ...response.data[job.type] });
      } else {
        toast.error(response.data.message);
      }
    } catch (error) {
      console.log(error);
      toast.error(getErrorMessage(error));
    } finally {
      setActionLoading(false);
    }
  }

  async function markArrived() {
    if (!job) return;

    try {
      setActionLoading(true);
      const response = await api.patch(`/ride/arrived/${job._id}`);

      if (response.data.success) {
        setJob({ ...job, arrivedAt: response.data.arrivedAt });
        toast.success("Customer notified that you've arrived.");
      } else {
        toast.error(response.data.message);
      }
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setActionLoading(false);
    }
  }

  async function completeJob() {
    if (!job) return;

    try {
      setActionLoading(true);

      const endpoint =
        job.type === "ride"
          ? `/ride/complete/${job._id}`
          : `/delivery/complete/${job._id}`;

      const response = await api.patch(endpoint);

      if (response.data.success) {
        toast.success(`${job.type === "ride" ? "Ride" : "Delivery"} completed successfully!`);
        navigate("/driver");
      } else {
        toast.error(response.data.message);
      }
    } catch (error) {
      console.log(error);
      toast.error(getErrorMessage(error));
    } finally {
      setActionLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="card p-8 text-center">
          <p className="text-sm text-muted">Loading active trip...</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="max-w-2xl mx-auto bg-surface border border-danger/30 rounded-xl p-8 text-center space-y-3">
        <p className="text-sm text-danger">{loadError}</p>
        <button type="button" onClick={() => getActiveJob()} className="px-4 py-2 rounded-xl bg-fg text-bg hover:bg-primary hover:text-on-primary transition-colors text-xs font-semibold">
          Try again
        </button>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="card p-8 text-center">
          <CheckCircle2 className="w-12 h-12 text-subtle mx-auto mb-3" />
          <h2 className="text-lg font-bold text-fg">No Active Trip</h2>
          <p className="text-sm text-muted mt-1">
            You don't have an accepted or started ride/delivery right now.
          </p>
          <button
            onClick={() => navigate("/driver")}
            className="mt-5 bg-primary hover:bg-primary-hover text-on-primary px-5 py-2 rounded-xl text-sm font-semibold"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const isDelivery = job.type === "delivery";

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate("/driver")}
          className="p-2 rounded-xl border border-line hover:bg-surface-2"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-xl font-bold text-fg">Manage Trip</h1>
          <p className="text-xs text-muted">
            Manage your current {isDelivery ? "delivery" : "ride"}
          </p>
        </div>
      </div>

      <div className="card p-4">
        <TripMap job={job} height={300} />
      </div>

      <div className="card p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-sm font-bold text-fg">
            {isDelivery ? "Delivery Information" : "Ride Information"}
          </h2>
          <span
            className={`px-3 py-1 rounded-full text-xs font-bold  ${
              job.status === "accepted"
                ? "bg-info-soft text-info"
                : "bg-warning-soft text-warning"
            }`}
          >
            {job.status}
          </span>
        </div>

        <div className="flex gap-3 mb-4">
          <div className="w-9 h-9 rounded-xl bg-primary-soft flex items-center justify-center">
            <MapPin className="w-5 h-5 text-link" />
          </div>
          <div>
            <p className="text-xs text-muted">Pickup Location</p>
            <p className="text-sm font-semibold text-fg">{job.pickupLocation}</p>
          </div>
        </div>

        <div className="flex gap-3 mb-5">
          <div className="w-9 h-9 rounded-xl bg-danger-soft flex items-center justify-center">
            <MapPin className="w-5 h-5 text-danger" />
          </div>
          <div>
            <p className="text-xs text-muted">Destination</p>
            <p className="text-sm font-semibold text-fg">{job.destination}</p>
          </div>
        </div>

        <div className="border-t border-line pt-5 space-y-4">
          <div className="flex items-center gap-3">
            <User className="w-5 h-5 text-muted" />
            <div>
              <p className="text-xs text-muted">Customer</p>
              <p className="text-sm font-semibold text-fg">
                {job.customer?.name || "Customer"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Phone className="w-5 h-5 text-muted" />
            <div>
              <p className="text-xs text-muted">Phone</p>
              <p className="text-sm font-semibold text-fg">
                {job.customer?.phone || "Not available"}
              </p>
            </div>
          </div>

          {isDelivery ? (
            <>
              <div className="flex items-center gap-3">
                <User className="w-5 h-5 text-muted" />
                <div>
                  <p className="text-xs text-muted">Receiver</p>
                  <p className="text-sm font-semibold text-fg">
                    {job.receiverName} ({job.receiverPhone})
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Package className="w-5 h-5 text-muted" />
                <div>
                  <p className="text-xs text-muted">Package</p>
                  <p className="text-sm font-semibold text-fg">{job.packageDescription}</p>
                </div>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-3">
              <Bike className="w-5 h-5 text-muted" />
              <div>
                <p className="text-xs text-muted">Vehicle</p>
                <p className="text-sm font-semibold text-fg capitalize">{job.vehicleType}</p>
              </div>
            </div>
          )}

          {job.notes && (
            <div className="p-3 bg-warning-soft border border-warning/30 rounded-xl text-xs text-warning">
              <b>Customer note:</b> {job.notes}
            </div>
          )}

          <div className="flex items-center gap-3">
            <DollarSign className="w-5 h-5 text-link" />
            <div>
              <p className="text-xs text-muted">{job.agreedFare != null ? "Agreed Fare" : "Offered Fare"}</p>
              <p className="text-lg font-bold text-link">PKR {job.agreedFare ?? job.offeredFare}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="card p-6">
        <h2 className="text-sm font-bold text-fg mb-4">Trip Actions</h2>

        {job.status === "accepted" && !isDelivery && !job.arrivedAt && (
          <button
            onClick={markArrived}
            disabled={actionLoading}
            className="w-full mb-3 flex items-center justify-center gap-2 border-2 border-primary text-link hover:bg-primary-soft disabled:opacity-50 py-3 rounded-xl text-sm font-semibold"
          >
            <MapPin className="w-5 h-5" />
            {actionLoading ? "Notifying..." : "I've Arrived"}
          </button>
        )}

        {job.status === "accepted" && !isDelivery && job.arrivedAt && (
          <p className="mb-3 text-xs font-semibold text-link bg-primary-soft border border-primary/30 rounded-xl p-2.5">
            Customer notified of your arrival at {new Date(job.arrivedAt).toLocaleTimeString()}. Start the ride when they are on board.
          </p>
        )}

        {job.status === "accepted" && (
          <button
            onClick={startJob}
            disabled={actionLoading}
            className="w-full flex items-center justify-center gap-2 bg-primary hover:bg-primary-hover disabled:opacity-50 text-on-primary py-3 rounded-xl text-sm font-semibold"
          >
            <Play className="w-5 h-5" />
            {actionLoading ? "Starting..." : `Start ${isDelivery ? "Delivery" : "Ride"}`}
          </button>
        )}

        {job.status === "started" && (
          <button
            onClick={completeJob}
            disabled={actionLoading}
            className="w-full flex items-center justify-center gap-2 bg-info hover:bg-info disabled:opacity-50 text-white py-3 rounded-xl text-sm font-semibold"
          >
            <CheckCircle2 className="w-5 h-5" />
            {actionLoading ? "Completing..." : `Complete ${isDelivery ? "Delivery" : "Ride"}`}
          </button>
        )}
      </div>
    </div>
  );
}
