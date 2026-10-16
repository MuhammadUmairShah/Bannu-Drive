/* ---------------------------------------------------------------------------
   Every image URL for the public site lives here (Unsplash CDN).
   To swap a photo, replace the URL. Keep the ?w=...&q=... params for speed.
--------------------------------------------------------------------------- */
const u = (id, w = 1600) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}&q=80`;

export const images = {
  // Landing page
  hero: u("photo-1449965408869-eaa3f722e40d", 2400), // open road, car at dusk
  bike: u("photo-1558981806-ec527fa84c39", 1000), // motorcycle
  rickshaw: u("photo-1626149637281-4e227308da18", 1000), // auto-rickshaw
  car: u("photo-1624578571415-09e9b1991929", 1000), // car
  bus: u("photo-1544620347-c4fd4a3d5957", 1000), // coach / bus
  about: u("photo-1556761175-5973dc0f32e7", 1400), // team at work
  travel: u("photo-1469854523086-cc02fe5d8800", 2400), // road journey

  // Inner pages
  servicesHero: u("photo-1502877338535-766e1452684a", 2200),
  aboutHero: u("photo-1464822759023-fed622ff2c3b", 2200),
  contactHero: u("photo-1534536281715-e28d76689b4d", 2200),
  story: u("photo-1521791136064-7986c2920216", 1400),
  safety: u("photo-1450101499163-c8848c66ca85", 1400),
};

/** Hide a broken image so the dark background underneath shows instead. */
export const hideBroken = (e) => {
  e.currentTarget.style.display = "none";
};
