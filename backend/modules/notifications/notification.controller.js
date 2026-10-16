import notificationModel from "./notification.model.js";

export async function listNotifications(req, res) {
  try {
    const limit = Math.min(Number(req.query.limit) || 30, 100);

    const [notifications, unreadCount] = await Promise.all([
      notificationModel.find({ recipient: req.user.id }).sort({ createdAt: -1 }).limit(limit),
      notificationModel.countDocuments({ recipient: req.user.id, read: false })
    ]);

    return res.json({ success: true, notifications, unreadCount });
  } catch (error) {
    console.error("List notifications error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong" });
  }
}

export async function markRead(req, res) {
  try {
    const notification = await notificationModel.findOneAndUpdate(
      { _id: req.params.notificationId, recipient: req.user.id },
      { read: true },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }

    return res.json({ success: true, notification });
  } catch (error) {
    console.error("Mark read error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong" });
  }
}

export async function markAllRead(req, res) {
  try {
    await notificationModel.updateMany({ recipient: req.user.id, read: false }, { read: true });
    return res.json({ success: true, message: "All notifications marked as read" });
  } catch (error) {
    console.error("Mark all read error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong" });
  }
}
