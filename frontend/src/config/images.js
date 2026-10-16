// ---------------------------------------------------------------------------
// Bannu Drive – landing page images
// All photos are from Unsplash (free to use under the Unsplash License).
// To replace an image: change the `src` below. Nothing else needs to change.
//
// `unsplash(id, width)` builds a link from the short photo id found at the
// end of any Unsplash photo URL, e.g. https://unsplash.com/photos/...-cktp9-mCH4Y
// You can also paste any full image URL (or a local file like "/images/hero.jpg").
// ---------------------------------------------------------------------------

const unsplash = (id, width = 1600) =>
  `https://unsplash.com/photos/${id}/download?force=true&w=${width}`;

export const IMAGES = {
  hero: {
    src: unsplash("cktp9-mCH4Y", 2200),
    alt: "White car driving along a mountain road",
    credit: "Joshua Earle / Unsplash",
  },
  bike: {
    src: unsplash("n_Mx83Utt64", 900),
    alt: "Rider on a motorcycle on a city street",
    credit: "Adam Bachmeyer / Unsplash",
  },
  rickshaw: {
    src: unsplash("OlFiyAz-PDk", 900),
    alt: "Yellow auto rickshaw parked on the street",
    credit: "Surya Teja / Unsplash",
  },
  car: {
    src: unsplash("UcFVVAan25w", 900),
    alt: "White hatchback driving on a city road",
    credit: "Dustin F Owen / Unsplash",
  },
  bus: {
    src: unsplash("6mcVaoGNz1w", 900),
    alt: "Coach bus on a mountain road",
    credit: "Juan Encalada / Unsplash",
  },
  banner: {
    src: unsplash("HWUX9YGXPSY", 2000),
    alt: "Car driving on an open road under a cloudy sky",
    credit: "Dzmitry Tselabionak / Unsplash",
  },
};
