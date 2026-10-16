// Which documents each role must provide. Add a type here and the whole system (API, UI, admin) picks it up.
export const DOC_STATUS = ["PENDING", "UNDER_REVIEW", "APPROVED", "REJECTED"];
export const CASE_STATUS = DOC_STATUS;

export const DOC_TYPES = {
  driver: [
    { type: "CNIC", label: "CNIC (front & back)", required: true, hint: "Clear photo or scan of both sides of your CNIC" },
    { type: "DRIVING_LICENSE", label: "Driving licence", required: true, hint: "Valid licence for the vehicle you drive" },
    { type: "VEHICLE_REGISTRATION", label: "Vehicle registration", required: true, hint: "Registration book / smart card of your vehicle" },
    { type: "PROFILE_PHOTO", label: "Profile photo", required: true, hint: "Clear photo of your face" },
    { type: "OWNERSHIP_AUTHORIZATION", label: "Ownership / authorization letter", required: false, hint: "Needed if the vehicle is not in your name" },
    { type: "OTHER", label: "Other document", required: false, hint: "Anything else the admin asked for" }
  ],
  operator: [
    { type: "CNIC", label: "Owner CNIC (front & back)", required: true, hint: "CNIC of the person who owns or manages the company" },
    { type: "BUSINESS_REGISTRATION", label: "Business / operator registration", required: true, hint: "Company, firm or transport licence" },
    { type: "COACH_REGISTRATION", label: "Coach registration", required: true, hint: "Registration documents of your coaches" },
    { type: "ROUTE_PERMIT", label: "Route permit", required: true, hint: "Route / inter-city permit" },
    { type: "OWNERSHIP_AUTHORIZATION", label: "Ownership / authorization letter", required: false, hint: "If coaches are owned by someone else" },
    { type: "OTHER", label: "Other document", required: false, hint: "Anything else the admin asked for" }
  ]
};

export const SUBJECT_ROLES = Object.keys(DOC_TYPES);

export const requirementsFor = (role) => DOC_TYPES[role] || [];
export const requiredTypesFor = (role) => requirementsFor(role).filter((d) => d.required).map((d) => d.type);

// Private upload rules
export const MAX_DOC_BYTES = 5 * 1024 * 1024; // 5 MB
export const ALLOWED_DOC_MIME = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
export const MAX_IMAGE_DIMENSION = 12000; // px, rejects absurd/decompression-bomb images
