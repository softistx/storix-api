import type { ObjectId } from "mongodb";

// The filter of the rows after a position, newest first: a later date, or the
// same date and a later (smaller) id.
export const afterPosition = (
  field: string,
  after: { date: Date; _id: ObjectId } | null,
) =>
  after
    ? {
        $or: [
          { [field]: { $lt: after.date } },
          { [field]: after.date, _id: { $lt: after._id } },
        ],
      }
    : {};
