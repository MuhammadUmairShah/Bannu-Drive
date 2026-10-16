// Single place for brand + city settings. Nothing else in the UI should hard-code these.
export const BRAND = {
  name: 'Bannu Drive',
  tagline: 'Rides, parcels and intercity coaches',
  supportEmail: 'support@bannudrive.pk'
};

// Where the app starts. Search is biased to this area but never limited to it:
// riders and coaches can go anywhere in Pakistan (Bannu -> Peshawar, Lahore, ...).
export const DEFAULT_CITY = 'Bannu';
export const DEFAULT_VIEWBOX = '70.25,33.25,71.00,32.50'; // west,north,east,south
