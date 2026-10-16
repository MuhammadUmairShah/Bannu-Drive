// MongoDB reports a unique-index violation as code 11000 ("E11000 duplicate key"). Some MongoDB-compatible servers
// only mention it in the message, so check both.
export const isDuplicateKey = (error) =>
  error?.code === 11000 || /E11000|UNIQUE constraint failed|duplicate key/i.test(String(error?.message || ""));
