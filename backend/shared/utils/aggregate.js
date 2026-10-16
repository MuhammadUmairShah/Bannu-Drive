// Small, portable aggregation helpers: every query uses ONE accumulator, so it behaves the
// same on MongoDB and MongoDB-compatible servers.

export async function sumField(Model, match, field) {
  const [row] = await Model.aggregate([{ $match: match }, { $group: { _id: null, total: { $sum: `$${field}` } } }]);
  return row ? row.total : 0;
}

// { "<groupValue>": sum } for one numeric field
export async function sumByKey(Model, match, key, field) {
  const rows = await Model.aggregate([{ $match: match }, { $group: { _id: `$${key}`, total: { $sum: `$${field}` } } }]);
  return Object.fromEntries(rows.map((r) => [String(r._id), r.total]));
}

// { "<groupValue>": count }
export async function countByKey(Model, match, key) {
  const rows = await Model.aggregate([{ $match: match }, { $group: { _id: `$${key}`, total: { $sum: 1 } } }]);
  return Object.fromEntries(rows.map((r) => [String(r._id), r.total]));
}
